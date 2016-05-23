var fs      = require('fs');
var extend  = require('extend');
var util    = require('util');

function SqliteAdapter(opts) {
  extend(this, opts);
}

SqliteAdapter.prototype.connect = function (cb) {
  if (this.knex) return cb();
  this.knex = require('knex')({
    client: 'sqlite3',
    connection: {
      filename: this.path || ':memory:',
    },
    debug: false,
    useNullAsDefault: true,
  });
  cb();
};

SqliteAdapter.prototype.upsert = function (properties, cb) {
  var keys = Object.keys(properties);
  var values = keys.map(function (k) {
    return properties[k];
  });
  var sql = 'INSERT OR REPLACE INTO ' + this.tableName + ' (' + keys.join(',') + ') VALUES (' + values.map(function (x) { return '?'; }).join(',') + ')';
  this.knex.raw(sql, values).then(function () { cb(); }).error(cb);
};

SqliteAdapter.prototype.close = function (cb) {
  if (this.path === ':memory:') return cb();
  fs.unlink(this.path, function (err) {
    cb();
  });
};

module.exports = SqliteAdapter;
