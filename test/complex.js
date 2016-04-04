var assert = require('assert');
var Queue = require('../lib/queue');
var MemoryStore = require('../lib/stores/memory');

describe('Complex Queue', function() {

  it('should run in batch mode', function (done) {
    var q = new Queue({
      batchSize: 3,
      process: function (batch, cb) {
        assert.equal(batch.length, 3);
        var total = 0;
        batch.forEach(function (task) {
          total += task;
        })
        cb(null, total);
      },
    })
    var queued = 0;
    q.on('task_queued', function () {
      queued++;
      if (queued >= 3) {
        q.resume();
      }
    })
    q.pause();
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
    var finished = 0;
    var queued = 0;
    var q1 = new Queue(function (n, cb) { throw new Error('failed') }, { store: s })
    q1.on('task_queued', function () {
      queued++;
      if (queued >= 3) {
        var q2 = new Queue(function (n, cb) {
          finished++;
          cb();
          if (finished === 3) {
            done();
          }
        }, { store: s });
      }
    })
    q1.pause();
    q1.push(1);
    q1.push(2);
    q1.push(3);
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
      assert.equal(tasks.length, 2);
      cb();
      done();
    },  { batchSize: 3, processDelay: 3 });
    var queued = 0;
    q.on('task_queued', function () {
      queued++;
      if (queued >= 2) {
        q.resume();
      }
    })
    q.pause();
    q.push(1);
    q.push(2);
  })

  it('should max timeout', function (done) {
    var q = new Queue(function (tasks, cb) {}, { maxTimeout: 1 })
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
      id: 'id',
      merge: function (a, b, cb) {
        a.x += b.x;
        cb(null, a);
      }
    })
    var queued = 0;
    q.on('task_queued', function () {
      queued++;
      if (queued >= 2) {
        q.resume();
      }
    })
    q.on('task_finish', function (taskId, r) {
      if (taskId === '1') {
        done();
      }
    })
    q.pause()
    q.push({ id: '0', x: 4 });
    q.push({ id: '1', x: 1 }, function (err, r) {
      assert.ok(!err)
    });
    q.push({ id: '1', x: 2 }, function (err, r) {
      assert.ok(!err);
    });
  })
  
  it('should respect id property (string)', function (done) {
    var q = new Queue(function (o, cb) {
      if (o.name === 'john') {
        assert.equal(o.x, 4);
        cb();
      }
      if (o.name === 'mary') {
        assert.equal(o.x, 5);
        cb();
      }
      if (o.name === 'jim') {
        assert.equal(o.x, 2);
        cb();
      }
    }, {
      id: 'name',
      merge: function (a, b, cb) {
        a.x += b.x;
        cb(null, a);
      }
    })
    var finished = 0;
    var queued = 0;
    q.on('task_finish', function (taskId, r) {
      finished++;
      if (finished >= 3) done();
    })
    q.on('task_queued', function (taskId, r) {
      queued++;
      if (queued >= 3) {
        q.resume();
      }
    })
    q.pause();
    q.push({ name: 'john', x: 4 });
    q.push({ name: 'mary', x: 3 });
    q.push({ name: 'jim', x: 1 });
    q.push({ name: 'jim', x: 1 });
    q.push({ name: 'mary', x: 2 });
  })
  
  it('should respect id property (function)', function (done) {
    var finished = 0;
    var q = new Queue(function (n, cb) {
      cb(null, n)
    }, {
      batchDelay: 3,
      id: function (n, cb) {
        cb(null, n % 2 === 0 ? 'even' : 'odd');
      },
      merge: function (a, b, cb) {
        cb(null, a+b);
      }
    })
    var finished = 0;
    var queued = 0;
    q.on('task_queued', function (taskId, r) {
    })
    q.on('task_finish', function (taskId, r) {
      finished++;
      if (taskId === 'odd') {
        assert.equal(r, 9);
      }
      if (taskId === 'even') {
        assert.equal(r, 6);
      }
      if (finished >= 2) {
        done();
      }
    })
    q.push(1);
    q.push(2);
    q.push(3);
    q.push(4);
    q.push(5);
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
    }, { id: 'id', cancelIfRunning: true })
    q.push({ id: 1 })
      .on('started', function () {
        q.push({ id: 2 });
        setTimeout(function () {
          q.push({ id: 1 });
        }, 1)
      });
  })
  

})
