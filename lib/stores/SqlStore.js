var extend = require('extend');
var uuid   = require('node-uuid');
var util   = require('util');

function SqlStore(opts) {
  opts = opts || {};
  opts.tableName = opts.tableName || 'tasks_' + uuid.v4().replace(/-/g, '');
  extend(this, opts);

  var dialect = opts.dialect || 'sqlite';
  if (dialect === 'sqlite') {
    var Adapter = require('./SqliteAdapter');
    this.adapter = new Adapter(opts);
  } else if (dialect === 'postgres') {
    var Adapter = require('./PostgresAdapter');
    this.adapter = new Adapter(opts);
  } else {
    throw new Error("Unhandled dialect: " + dialect);
  }
  this.dialect = dialect;
}

// http://stackoverflow.com/questions/11532550/atomic-update-select-in-postgres
var takeNextN = function (first) {
  return function (n, cb) {
    var self = this;
    var subquery = function (fields, n) {
      return self.adapter.knex(self.tableName).select(fields).where('lock', '').orderBy('priority', 'DESC').orderBy('added', first ? 'ASC' : 'DESC').limit(n);
    };
    var lockId = uuid.v4();
    self.adapter.knex(self.tableName)
      .where('lock', '').andWhere('id', 'in', subquery(['id'], n))
      .update({ lock: lockId })
      .then(function (numUpdated) {
        cb(null, numUpdated > 0 ? lockId : '');
      }).error(cb);
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
    self.adapter.knex.raw(sql).then(function () {
      self.adapter.knex(self.tableName).count('*').where('lock', '').then(function (rows) {
        var row = rows[0];
        cb(null, row ? row['count'] || row['count(*)'] : 0);
      });
    }).error(cb);
  });
};

SqlStore.prototype.getTask = function (taskId, cb) {
  this.adapter.knex(this.tableName).where('id', taskId).andWhere('lock', '').then(function (rows) {
    if (!rows.length) return cb();
    var row = rows[0];
    try {
      var savedTask = JSON.parse(row.task);
    } catch (e) {
      return cb('failed_to_deserialize_task');
    }
    cb(null, savedTask);
  }).error(cb);
};

SqlStore.prototype.deleteTask = function (taskId, cb) {
  this.adapter.knex(this.tableName).where('id', taskId).del().then(function () { cb(); }).error(cb);
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
  this.adapter.knex(this.tableName).select(['id', 'task']).where('lock', lockId).then(function (rows) {
    var tasks = {};
    rows.forEach(function (row) {
      tasks[row.id] = JSON.parse(row.task);
    })
    cb(null, tasks);
  }).error(cb);
};

SqlStore.prototype.getRunningTasks = function (cb) {
  this.adapter.knex(this.tableName).select(['id', 'task', 'lock']).then(function (rows) {
    var tasks = {};
    rows.forEach(function (row) {
      tasks[row.lock] = tasks[row.lock] || [];
      tasks[row.lock][row.id] = JSON.parse(row.task);
    })
    cb(null, tasks);
  }).error(cb);
};

SqlStore.prototype.releaseLock = function (lockId, cb) {
  this.adapter.knex(this.tableName).where('lock', lockId).del().then(function () { cb(); }).error(cb);
};

SqlStore.prototype.close = function (cb) {
  if (this.adapter) return this.adapter.close(cb);
  cb();
};

module.exports = SqlStore;
