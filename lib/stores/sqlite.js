var uuid = require('node-uuid');
var sqlite3 = require('sqlite3').verbose();

function SQLiteStore(opts) {
  this.db = new sqlite3.Database(':memory:');
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
        console.log(tasks)
        cb(null, tasks);
        self.db.run("DELETE FROM tasks WHERE lock = ?", lock);
      });
    });
  }
}

SQLiteStore.prototype.connect = function (cb) {
  this.db.run("CREATE TABLE IF NOT EXISTS tasks (id TEXT UNIQUE, lock TEXT, task TEXT, priority NUMERIC, added INTEGER PRIMARY KEY AUTOINCREMENT)", cb);
}

SQLiteStore.prototype.getTask = function (taskId, cb) {
  this.db.get("SELECT * FROM tasks WHERE id = ?", taskId, cb);
}

SQLiteStore.prototype.putTask = function (taskId, task, priority, cb) {
  try {
    var serializedTask = JSON.stringify(task);
  } catch (e) {
    return cb('failed_to_serialize_task');
  }
  console.log("PUT", taskId, task, priority)
  this.db.run("INSERT OR REPLACE INTO tasks VALUES (?, ?, ?, ?, NULL)", [taskId, '', serializedTask, priority || 1], cb);
}

SQLiteStore.prototype.takeFirstN = takeNextN(true);
SQLiteStore.prototype.takeLastN = takeNextN(false);

module.exports = SQLiteStore;
