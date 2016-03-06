var assert = require('assert');
var Queue = require('../lib/queue');
var MemoryStore = require('../lib/stores/memory');

describe('Complex Queue', function() {

  it('should run in batch mode', function (done) {
    var q = new Queue({
      batchSize: 3,
      process: function (batch, cb) {
        assert.equal(Object.keys(batch).length, 3);
        var total = 0;
        Object.keys(batch).forEach(function (taskId) {
          total += batch[taskId];
        })
        cb(null, total);
      },
    })
    q.push(1, function (err, total) {
      assert.equal(total, 6);
    })
    q.push(2, function (err, total) {
      assert.equal(total, 6);
    })
    q.push(3, function (err, total) {
      assert.equal(total, 6);
      done();
    })
  })

  it('should store properly', function (done) {
    var s = new MemoryStore();
    var q1 = new Queue(function (n, cb) {
      cb(null, n);
    }, { store: s })
    q1.pause();
    q1.push(1);
    q1.push(2);
    q1.push(3);
    var q2 = new Queue(function (n, cb) {
      cb();
      if (n === 3) {
        done();
      }
    }, { store: s });
  })

  it('should retry', function (done) {
    var tries = 0;
    var q = new Queue(function (n, cb) {
      tries++;
      if (tries === 3) {
        cb();
        done();
      } else {
        cb('fail');
      }
    }, { maxRetries: 3 });
    q.push(1);
  })

  it('should fail retry', function (done) {
    var tries = 0;
    var q = new Queue(function (n, cb) {
      tries++;
      if (tries === 3) {
        cb();
      } else {
        cb('fail');
      }
    }, { maxRetries: 2 })
    q.on('task_failed', function () {
      done();
    });
    q.push(1);
  })

  it('should process delay', function (done) {
    var q = new Queue(function (tasks, cb) {
      assert.equal(Object.keys(tasks).length, 2);
      cb();
      done();
    }, { batchSize: 3, processDelay: 3 });
    q.push(1);
    setTimeout(function () {
      q.push(2);
    }, 1)
  })

  it('should max timeout', function (done) {
    var q = new Queue(function (tasks, cb) {}, { processTimeout: 1 })
    q.on('task_failed', function (taskId, msg) {
      assert.equal(msg, 'task_timeout');
      done();
    });
    q.push(1, function (err, r) {
      assert.equal(err, 'task_timeout');
    });
  })

  it('should merge tasks', function (done) {
    var q = new Queue(function (o, cb) {
      if (o.id === 1) {
        assert.equal(o.x, 3);
        cb();
      } else {
        cb();
      }
    }, {
      merge: function (a, b, cb) {
        a.x += b.x;
        cb(null, a);
      }
    })
    q.on('task_finish', function (taskId, r) {
      if (taskId === '1') {
        done();
      }
    })
    q.push({ id: '0', x: 4 });
    q.push({ id: '1', x: 1 }, function (err, r) {
      assert.ok(!err)
    });
    q.push({ id: '1', x: 2 }, function (err, r) {
      assert.ok(!err);
    });
  })
  
  it('should cancel if running', function (done) {
    var ran = 0;
    var cancelled = false;
    var q = new Queue(function (n, cb) {
      ran++;
      if (ran >= 2) {
        cb();
      }
      if (ran === 3) {
        assert.ok(cancelled);
        done();
      }
      return {
        cancel: function () {
          cancelled = true;
        }
      }
    }, { cancelIfRunning: true })
    q.push({ id: 1 });
    q.push({ id: 2 });
    setTimeout(function () {
      q.push({ id: 1 });
    }, 1)
  })
  
  // TODO: Test progress
  // TODO: Test stores

})
