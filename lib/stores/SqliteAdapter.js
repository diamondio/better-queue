var fs      = require('fs');
var extend  = require('extend');
var sqlite3 = require('sqlite3').verbose();
var util    = require('util');

function SqliteAdapter(opts) {
  extend(this, opts);
}

SqliteAdapter.prototype.connect = function (cb) {
  var self = this;
  var path = self.path || ':memory:';
  self.adapter = new sqlite3.Database(path, function () {
    self.adapter.serialize(cb);
  });
};

SqliteAdapter.prototype.upsert = function (properties, cb) {
  var keys = Object.keys(properties);
  var values = keys.map(function (k) {
    var value = properties[k];
    return typeof(value) === 'string' ? util.format("'%s'", value) : value;
  });
  var sql = util.format('INSERT OR REPLACE INTO %s (%s)', this.tableName, keys.join(','));
  sql += util.format(' VALUES (%s)', values.join(','));
  this.run(sql, cb);
};

SqliteAdapter.prototype.run = function (sql, cb) {
  if (this.verbose) console.log('run: ', sql);
  this.adapter.run(sql, cb);
};

SqliteAdapter.prototype.get = function (sql, cb) {
  if (this.verbose) console.log('get: ', sql);
  this.adapter.get(sql, cb);
};

SqliteAdapter.prototype.all = function (sql, cb) {
  if (this.verbose) console.log('all: ', sql);
  this.adapter.all(sql, cb);
};

SqliteAdapter.prototype.close = function (cb) {
  if (this.path === ':memory:') return cb();
  fs.unlink(this.path, function (err) {
    cb();
  });
};

module.exports = SqliteAdapter;
