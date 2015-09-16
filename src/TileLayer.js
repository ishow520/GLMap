
GLMap.TileLayer = function(source, options) {
  this.source = source;
  options = options || {};

  this.attribution = options.attribution;

  this.minZoom = parseFloat(options.minZoom) || 0;
  this.maxZoom = parseFloat(options.maxZoom) || 18;

  if (this.maxZoom < this.minZoom) {
    this.maxZoom = this.minZoom;
  }

//this.bgColor = Color.parse(options.bgColor || '#cccccc').toRGBA(true);
  this.buffer = options.buffer || 1;

  this.shader = new glx.Shader({
    vertexShader: Shaders.tile.vertex,
    fragmentShader: Shaders.tile.fragment,
    attributes: ["aPosition", "aTexCoord"],
    uniforms: ["uMatrix", "uMMatrix", "uTexIndex", "uFogRadius", "uFogColor"]
  });

  this.tiles = {};
};

GLMap.TileLayer.prototype = {

  addTo: function(map) {
    this.map = map;
    map.addLayer(this);

    map.on('change', function() {
      this.update(2000);
    }.bind(this));

    map.on('resize', this.update.bind(this));

    this.update();
  },

  remove: function() {
    clearTimeout(this.isWaiting);
    this.map.removeLayer(this);
    this.map = null;
  },

  // strategy: start loading after {delay}ms, skip any attempts until then
  // effectively loads in intervals during movement
  update: function(delay) {
    var map = this.map;

    if (map.zoom < this.minZoom || map.zoom > this.maxZoom) {
      return;
    }

    if (!delay) {
      this.loadTiles();
      return;
    }

    if (this.isWaiting) {
      return;
    }

    this.isWaiting = setTimeout(function() {
      this.isWaiting = null;
      this.loadTiles();
    }.bind(this), delay);
  },

  getURL: function(x, y, z) {
    var param = { s:'abcd'[(x+y) % 4], x:x, y:y, z:z };
    return this.source.replace(/\{(\w+)\}/g, function(tag, key) {
      return param[key] || tag;
    });
  },

  updateBounds: function() {
    var
      map = this.map,
      tileZoom = Math.round(map.zoom),
      radius = 1500, // SkyDome.radius,
      ratio = Math.pow(2, tileZoom-map.zoom)/GLMap.TILE_SIZE,
      mapCenter = map.center;

    this.minX = ((mapCenter.x-radius)*ratio <<0);
    this.minY = ((mapCenter.y-radius)*ratio <<0);
    this.maxX = Math.ceil((mapCenter.x+radius)*ratio);
    this.maxY = Math.ceil((mapCenter.y+radius)*ratio);
  },

  loadTiles: function() {
    this.updateBounds();

    var
      map = this.map,
      tileX, tileY,
      tileZoom = Math.round(map.zoom),
      key,
      queue = [], queueLength,
      tileAnchor = [
        map.center.x/GLMap.TILE_SIZE <<0,
        map.center.y/GLMap.TILE_SIZE <<0
      ];

    for (tileY = this.minY; tileY < this.maxY; tileY++) {
      for (tileX = this.minX; tileX < this.maxX; tileX++) {
        key = [tileX, tileY, tileZoom].join(',');
        if (this.tiles[key]) {
          continue;
        }
        this.tiles[key] = new GLMap.Tile(tileX, tileY, tileZoom);
        // TODO: rotate anchor point
        queue.push({ tile:this.tiles[key], dist:distance2([tileX, tileY], tileAnchor) });
      }
    }

    if (!(queueLength = queue.length)) {
      return;
    }

    queue.sort(function(a, b) {
      return a.dist-b.dist;
    });

    var tile;
    for (var i = 0; i < queueLength; i++) {
      tile = queue[i].tile;
      tile.load(this.getURL(tile.x, tile.y, tile.zoom));
    }

    this.purge();
  },

  purge: function() {
    for (var key in this.tiles) {
      if (!this.isVisible(this.tiles[key], this.buffer)) {
        this.tiles[key].destroy();
        delete this.tiles[key];
      }
    }
  },

  isVisible: function(tile, buffer) {
     buffer = buffer || 0;
     var
       tileX = tile.x,
       tileY = tile.y,
       tileZoom = Math.round(this.map.zoom);
     // TODO: factor in tile origin
     return (tile.zoom === tileZoom && (tileX >= this.minX-buffer && tileX <= this.maxX+buffer && tileY >= this.minY-buffer && tileY <= this.maxY+buffer));
  },

  render: function(vpMatrix) {
    var
      map = this.map,
      fogColor = map.fogColor,
      gl = map.context,
      shader = this.shader,
      tile, mMatrix,
      tileZoom = Math.round(map.zoom),
      ratio = 1 / Math.pow(2, tileZoom - map.zoom),
      mapCenter = map.center;

    shader.enable();

    gl.uniform1f(shader.uniforms.uFogRadius, map.renderer.fogRadius);
    gl.uniform3fv(shader.uniforms.uFogColor, [fogColor.r, fogColor.g, fogColor.b]);

    for (var key in this.tiles) {
      tile = this.tiles[key];

      if (!tile.isReady) {
        continue;
      }

      mMatrix = new glx.Matrix();
      mMatrix.scale(ratio * 1.005, ratio * 1.005, 1);
      mMatrix.translate(tile.x * GLMap.TILE_SIZE * ratio - mapCenter.x, tile.y * GLMap.TILE_SIZE * ratio - mapCenter.y, 0);

      gl.uniformMatrix4fv(shader.uniforms.uMMatrix, false, mMatrix.data);
      gl.uniformMatrix4fv(shader.uniforms.uMatrix, false, glx.Matrix.multiply(mMatrix, vpMatrix));

      tile.vertexBuffer.enable();
      gl.vertexAttribPointer(shader.attributes.aPosition, tile.vertexBuffer.itemSize, gl.FLOAT, false, 0, 0);

      tile.texCoordBuffer.enable();
      gl.vertexAttribPointer(shader.attributes.aTexCoord, tile.texCoordBuffer.itemSize, gl.FLOAT, false, 0, 0);

      tile.texture.enable(0);
      gl.uniform1i(shader.uniforms.uTexIndex, 0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, tile.vertexBuffer.numItems);
    }

    shader.disable();
  },

  destroy: function() {
    for (var key in this.tiles) {
      this.tiles[key].destroy();
    }
    this.tiles = null;
    this.remove();
  }
};
