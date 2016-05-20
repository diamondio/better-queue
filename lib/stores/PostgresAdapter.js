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
    self.initialize(function (err) {
      if (err) return cb(err);
      cb(null, client);
    });
  });
};

// http://stackoverflow.com/questions/1109061/insert-on-duplicate-update-in-postgresql
PostgresAdapter.prototype.initialize = function (cb) {
  var sql = '                                                                                                                     \n\
    CREATE OR REPLACE FUNCTION upsert_' + this.tableName + '(_id TEXT, _lock TEXT, _task TEXT, _priority NUMERIC) RETURNS VOID AS \n\
    $$                                                                                                                            \n\
    BEGIN                                                                                                                         \n\
        LOOP                                                                                                                      \n\
            -- first try to update the key                                                                                        \n\
            -- note that "id" must be unique                                                                                      \n\
            UPDATE ' + this.tableName + ' SET lock=_lock, task=_task, priority=_priority WHERE id=_id;                            \n\
            IF found THEN                                                                                                         \n\
                RETURN;                                                                                                           \n\
            END IF;                                                                                                               \n\
            -- not there, so try to insert the key                                                                                \n\
            -- if someone else inserts the same key concurrently,                                                                 \n\
            -- we could get a unique-key failure                                                                                  \n\
            BEGIN                                                                                                                 \n\
                INSERT INTO ' + this.tableName + ' (id, lock, task, priority) VALUES (_id, _lock, _task, _priority);              \n\
                RETURN;                                                                                                           \n\
            EXCEPTION WHEN unique_violation THEN                                                                                  \n\
                -- do nothing, and loop to try the UPDATE again                                                                   \n\
            END;                                                                                                                  \n\
        END LOOP;                                                                                                                 \n\
    END;                                                                                                                          \n\
    $$                                                                                                                            \n\
    LANGUAGE plpgsql;                                                                                                             \n\
  ';
  this.run(sql, function (err) {
    if (err) console.error('Error initializing: ', err);
    cb(err);
  });
};

PostgresAdapter.prototype.upsert = function (properties, cb) {
  var sql = util.format("SELECT upsert_%s('%s', '%s', '%s', %s)", this.tableName, properties.id, properties.lock, properties.task, properties.priority);
  this.run(sql, cb);
};

PostgresAdapter.prototype.run = function (sql, cb) {
  if (this.verbose) console.log('run: ', sql);
  this.adapter.query(sql, function (err, result) {
    if (err) console.error('error in run: ', err, sql);
    cb(err, result);
  });
};

PostgresAdapter.prototype.get = function (sql, cb) {
  if (this.verbose) console.log('get: ', sql);
  this.all(sql, function (err, rows) {
    if (err) return cb(err);
    cb(null, rows.length ? rows[0] : null);
  });
};

PostgresAdapter.prototype.all = function (sql, cb) {
  if (this.verbose) console.log('all: ', sql);
  this.adapter.query(sql, function (err, result) {
    if (err) {
      console.error('error in all: ', err, sql);
      return cb(err);
    }
    cb(null, result.rows);
  });
};

PostgresAdapter.prototype.close = function (cb) {
  var self = this;
  if (!self.adapter) return cb();
  self.adapter.query(util.format('DROP FUNCTION IF EXISTS upsert_%s(text, text, text, numeric)', self.tableName), function (err) {
    if (err) return cb(err);
    self.adapter.query(util.format('DROP TABLE IF EXISTS %s', self.tableName), cb);
  });
};

module.exports = PostgresAdapter;
