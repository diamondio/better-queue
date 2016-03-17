var uuid = require('node-uuid');
var sqlite3 = require('sqlite3').verbose();

function SQLiteStore(opts) {
  opts = opts || {};
  this.path = opts.path || ':memory:';
}

var takeNextN = function (first) {
  return function (n, cb) {
    var self = this;
    var sql = function (fields) {
      return "SELECT " + fields + " FROM tasks WHERE lock = '' ORDER BY priority DESC, added " + (first ? "ASC" : "DESC") + " LIMIT ?"
    };
    var lock = uuid.v4();
    self.db.run("UPDATE tasks SET lock = ? WHERE id IN (" + sql('id') + ")", [lock, n], function (err) {
      if (err) return cb(err);
      if (!this.changes) return cb(null, []);
      self.db.all("SELECT id, task FROM tasks WHERE lock = ?", lock, function (err, rows) {
        if (err) return cb(err)
        var tasks = {};
        rows.forEach(function (row) {
          tasks[row.id] = JSON.parse(row.task);
        })
        cb(null, tasks);
        self.db.run("DELETE FROM tasks WHERE lock = ?", lock);
      });
    });
  }
}

SQLiteStore.prototype.connect = function (cb) {
  var self = this;
  self.db = new sqlite3.Database(self.path, function (err) {
    if (err) return cb({ message: 'failed_to_open_sqlite_db' });
    self.db.run("CREATE TABLE IF NOT EXISTS tasks (id TEXT UNIQUE, lock TEXT, task TEXT, priority NUMERIC, added INTEGER PRIMARY KEY AUTOINCREMENT)", function (err) {
      if (err) return cb({ message: 'failed_to_create_table' });
      self.db.get("SELECT count(*) as n FROM tasks WHERE lock = ''", function (err, row) {
        if (err) return cb({ message: 'failed_to_fetch_count' });
        cb(null, row.n);
      });
    });
  });
}

SQLiteStore.prototype.getTask = function (taskId, cb) {
  this.db.get("SELECT task FROM tasks WHERE id = ? AND lock = ''", taskId, function (err, row) {
    if (err) return cb({ message: 'failed_to_get_from_sqlite_db' });
    if (!row) return cb(null);
    try {
      var savedTask = JSON.parse(row.task);
    } catch (e) {
      return cb('failed_to_deserialize_task');
    }
    cb(null, savedTask);
  });
}

SQLiteStore.prototype.putTask = function (taskId, task, priority, cb) {
  try {
    var serializedTask = JSON.stringify(task);
  } catch (e) {
    return cb('failed_to_serialize_task');
  }
  this.db.run("INSERT OR REPLACE INTO tasks VALUES (?, ?, ?, ?, NULL)", [taskId, '', serializedTask, priority || 1], cb);
}

SQLiteStore.prototype.takeFirstN = takeNextN(true);
SQLiteStore.prototype.takeLastN = takeNextN(false);

module.exports = SQLiteStore;
