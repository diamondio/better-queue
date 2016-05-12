var _      = require('lodash');
var extend = require('extend');
var uuid   = require('node-uuid');
var util   = require('util');

var PostgresAdapter = require('./PostgresAdapter');
var SqliteAdapter   = require('./SqliteAdapter');

function SqlStore(opts) {
  opts = opts || {};
  opts.tableName = opts.tableName || 'tasks';
  extend(this, opts);

  var dialect = opts.dialect || 'sqlite';
  if (dialect === 'sqlite') this.adapter = new SqliteAdapter(opts);
  else if (dialect === 'postgres') this.adapter = new PostgresAdapter(opts);
  else throw new Error("Unhandled dialect: " + dialect);
  this.dialect = dialect;
}

var takeNextN = function (first) {
  return function (n, cb) {
    var sql = function (tableName, fields, n) {
      return util.format("SELECT %s FROM %s WHERE lock = '' ORDER BY priority DESC, added " + (first ? "ASC" : "DESC") + " LIMIT %s", fields, tableName, n);
    };
    var lockId = uuid.v4();
    this.adapter.run(util.format("UPDATE %s SET lock = '%s' WHERE id IN (" + sql(this.tableName, 'id', n) + ")", this.tableName, lockId), function (err, result) {
      if (err) return cb(err);
      if (!this.changes && !_.get(result, 'rowCount')) return cb(null, '');
      cb(null, lockId);
    });
  };
};

SqlStore.prototype.connect = function (cb) {
  var self = this;
  self.adapter.connect(function (err) {
    if (err) return cb(err);
    var sql = util.format("CREATE TABLE IF NOT EXISTS %s (id TEXT UNIQUE, lock TEXT, task TEXT, priority NUMERIC", self.tableName);
    var dialect = self.dialect;
    if (dialect === 'sqlite') {
      sql += ", added INTEGER PRIMARY KEY AUTOINCREMENT)";
    } else if (dialect === 'postgres') {
      sql += ", added SERIAL PRIMARY KEY)";
    } else {
      throw new Error("Unhandled dialect: " + dialect);
    }
    self.adapter.run(sql, function (err) {
      if (err) return cb(err);
      self.adapter.get(util.format("SELECT count(*) as n FROM %s WHERE lock = ''", self.tableName), function (err, row) {
        if (err) return cb(err);
        cb(null, row ? row.n : 0);
      });
    });
  });
};

SqlStore.prototype.getTask = function (taskId, cb) {
  this.adapter.get(util.format("SELECT task FROM %s WHERE id = '%s' AND lock = ''", this.tableName, taskId), function (err, row) {
    if (err) return cb(err);
    if (!row) return cb(null);
    try {
      var savedTask = JSON.parse(row.task);
    } catch (e) {
      return cb('failed_to_deserialize_task');
    }
    cb(null, savedTask);
  });
};

SqlStore.prototype.deleteTask = function (taskId, cb) {
  this.adapter.run(util.format("DELETE FROM %s WHERE id = '%s'", this.tableName, taskId || ''), cb);
};

SqlStore.prototype.putTask = function (taskId, task, priority, cb) {
  try {
    var serializedTask = JSON.stringify(task);
  } catch (e) {
    return cb('failed_to_serialize_task');
  }
  this.adapter.upsert({ id: taskId, task: serializedTask, priority: priority || 1, lock: '' }, cb);
};

SqlStore.prototype.takeFirstN = takeNextN(true);
SqlStore.prototype.takeLastN = takeNextN(false);

SqlStore.prototype.getLock = function (lockId, cb) {
  this.adapter.all(util.format("SELECT id, task FROM %s WHERE lock = '%s'", this.tableName, lockId || ''), function (err, rows) {
    if (err) return cb(err);
    var tasks = {};
    rows.forEach(function (row) {
      tasks[row.id] = JSON.parse(row.task);
    })
    cb(null, tasks);
  });
};

SqlStore.prototype.getRunningTasks = function (cb) {
  this.adapter.all("SELECT id, task, lock FROM " + this.tableName, function (err, rows) {
    if (err) return cb(err);
    var tasks = {};
    rows.forEach(function (row) {
      tasks[row.lock] = tasks[row.lock] || [];
      tasks[row.lock][row.id] = JSON.parse(row.task);
    })
    cb(null, tasks);
  });
};

SqlStore.prototype.releaseLock = function (lockId, cb) {
  cb();
  this.adapter.run(util.format("DELETE FROM %s WHERE lock = '%s'", this.tableName, lockId || ''), function () {});
};

module.exports = SqlStore;
