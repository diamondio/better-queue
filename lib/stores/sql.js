var Sequelize = require('sequelize');
var uuid = require('node-uuid');

function SqlStore(opts) {
  opts = opts || {};
  var username = opts.username || 'username';
  var password = opts.password || null;
  this.sequelize = new Sequelize('tasks', username, password, {
    dialect: opts.dialect || 'sqlite',
    storage: opts.path || ':memory:',
    logging: opts.logging || false
  });
}

var takeNextN = function (first) {
  return function (n, cb) {
    var self = this;
    var sql = function (fields) {
      return "SELECT " + fields + " FROM tasks WHERE lock = '' ORDER BY priority DESC, added " + (first ? "ASC" : "DESC") + ` LIMIT ${n}`;
    };
    var lockId = uuid.v4();
    self.Tasks.update({ lock: lockId, }, { where: [`id IN (${sql("id")})`] }).then(function (results) {
      if (!results.length) return cb(null, '');
      cb(null, lockId);
    }).error(function (err) {
      cb(err);
    });
  }
};

SqlStore.prototype.connect = function (cb) {
  var self = this;
  self.Tasks = self.sequelize.define('Task', {
    id: { type: Sequelize.TEXT, unique: true },
    lock: { type: Sequelize.TEXT },
    task: { type: Sequelize.TEXT },
    priority: { type: Sequelize.DECIMAL },
    added: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true }
  });
  return self.sequelize.sync().then(function (err) {
    self.Tasks.count({
      lock: ''
    }).then(function (n) {
      cb(null, n);
    }).error(function (err) {
      cb({ message: 'failed_to_fetch_count' });
    });
  }).error(function (err) {
    cb({ message: 'failed_to_create_table' });
  });
};

SqlStore.prototype.getTask = function (taskId, cb) {
  this.Tasks.findOne({
    id: taskId,
    lock: ''
  }).then(function (row) {
    if (!row) return cb(null);
    try {
      var savedTask = JSON.parse(row.task);
    } catch (e) {
      return cb('failed_to_deserialize_task');
    }
    cb(null, savedTask);
  }).error(function (err) {
    cb({ message: 'failed_to_get_from_sqlite_db' });
  });
};

SqlStore.prototype.deleteTask = function (taskId, cb) {
  this.Tasks.destroy({
    where: {
      taskId: taskId
    }
  }).then(cb).error(cb);
};

SqlStore.prototype.putTask = function (taskId, task, priority, cb) {
  try {
    var serializedTask = JSON.stringify(task);
  } catch (e) {
    return cb('failed_to_serialize_task');
  }
  this.Tasks.upsert({
    id: taskId,
    lock: '',
    task: serializedTask,
    priority: priority || 1
  }).then(cb).error(cb);
};

SqlStore.prototype.takeFirstN = takeNextN(true);
SqlStore.prototype.takeLastN = takeNextN(false);

SqlStore.prototype.getLock = function (lockId, cb) {
  this.Tasks.findAll({
    attributes: ['id', 'task'],
    where: {
      lock: lockId
    }
  }).then(function (rows) {
    var tasks = {};
    rows.forEach(function (row) {
      tasks[row.id] = JSON.parse(row.task);
    })
    cb(null, tasks);
  });
};

SqlStore.prototype.getRunningTasks = function (cb) {
  this.Tasks.findAll({
    attributes: ['id', 'task', 'lock'],
  }).then(function (rows) {
    var tasks = {};
    rows.forEach(function (row) {
      tasks[row.lock] = tasks[row.lock] || [];
      tasks[row.lock][row.id] = JSON.parse(row.task);
    })
    cb(null, tasks);
  }).error(function (err) {
    cb({ message: 'failed_to_fetch_tasks' });
  });
};

SqlStore.prototype.releaseLock = function (lockId, cb) {
  this.Tasks.destroy({
    where: {
      lock: lockId
    }
  }).then(cb).error(cb);
};

module.exports = SqlStore;
