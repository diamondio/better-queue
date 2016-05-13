var _      = require('lodash');
var extend = require('extend');
var pg     = require('pg');
var util   = require('util');

function PostgresAdapter(opts) {
  extend(this, opts);
}

PostgresAdapter.prototype.connect = function (cb) {
  var self = this;
  var username = self.username || 'postgres';
  var credentials = username + (self.password ? ':' + self.password : '');
  var host = self.host || 'localhost';
  var port = self.port || 5432;
  var dbname = self.dbname || 'template1';
  var connString = 'postgres://';
  if (credentials) connString += credentials + '@';
  connString += util.format('%s:%s/%s', host, port, dbname);
  pg.connect(connString, function (err, client, done) {
    if (err) return cb(err);
    self.adapter = client;
    self.disconnect = done;
    cb(null, client);
  });
};

PostgresAdapter.prototype.upsert = function (properties, cb) {
  var keys = Object.keys(properties);
  var values = keys.map(function (k) {
    var value = properties[k];
    return typeof(value) === 'string' ? util.format("'%s'", value) : value;
  });
  var sql = util.format('INSERT INTO %s (%s)', this.tableName, keys.join(','));
  sql += util.format(' VALUES (%s)', values.join(','));
  sql += ' ON CONFLICT (id) DO UPDATE SET ';
  var updates = [];
  _.zip(keys, values).forEach(function (kv) {
    var key = kv[0];
    var value = kv[1];
    if (key === 'id') return;
    updates.push(util.format('%s=%s', key, value));
  });
  sql += updates.join(',');
  this.run(sql, cb);
};

PostgresAdapter.prototype.run = function (sql, cb) {
  if (this.verbose) console.log('run: ', sql);
  this.adapter.query(sql, function (err, result) {
    if (err) console.error(err);
    cb(err, result);
  });
};

PostgresAdapter.prototype.get = function (sql, cb) {
  if (this.verbose) console.log('get: ', sql);
  this.all(sql, function (err, rows) {
    if (err) console.error(err);
    if (err) return cb(err);
    cb(null, rows.length ? rows[0] : null);
  });
};

PostgresAdapter.prototype.all = function (sql, cb) {
  if (this.verbose) console.log('all: ', sql);
  this.adapter.query(sql, function (err, result) {
    if (err) console.error(err);
    if (err) return cb(err);
    cb(null, result.rows);
  });
};

PostgresAdapter.prototype.close = function (cb) {
  var self = this;
  self.adapter.query(util.format('DROP TABLE IF EXISTS %s', this.tableName), cb);
};

module.exports = PostgresAdapter;
