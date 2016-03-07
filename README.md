# Better Queue - Powerful flow control

[![npm package](https://nodei.co/npm/better-queue.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/better-queue/)

[![Build status](https://img.shields.io/travis/leanderlee/better-queue.svg?style=flat-square)](https://travis-ci.org/leanderlee/better-queue)
[![Dependency Status](https://img.shields.io/david/leanderlee/better-queue.svg?style=flat-square)](https://david-dm.org/leanderlee/better-queue)
[![Known Vulnerabilities](https://snyk.io/test/npm/better-queue/badge.svg?style=flat-square)](https://snyk.io/test/npm/better-queue)
[![Gitter](https://img.shields.io/badge/gitter-join_chat-blue.svg?style=flat-square)](https://gitter.im/leanderlee/better-queue?utm_source=badge)


## Super simple to use

Better Queue is designed to be simple to set up but still let you do complex things.

- Persistent (and extendable) storage
- Batched processing
- Prioritize tasks
- Merge/filter tasks
- Progress events (with ETA!)
- Fine-tuned timing controls
- Retry on fail
- Concurrent batch processing
- ... and more!

---

#### Install (via npm)

```bash
npm install --save better-queue
```

---

#### Quick Example

```js
var Queue = require('better-queue');

var options = {
  batchSize: 3,
  maxTimeout: 1000,
  concurrent: 2,
  maxRetries: 3,
  store: {
    type: "sqlite",
    path: "/path/to/db"
  },
  // ... and lots more!
}

var q = new Queue(function (n, cb) {
  cb(null, n);
}, options) // Options are optional

q.push(1)
q.push(2)
q.push(3)
```

## Table of contents

- [Queuing](#queuing)
- [Task Management](#task-management)
- [Timing](#timing)
- [Control Flow](#control-flow)
- [Status Updates](#status-updates)
- [Storage](#storage)
- [Full Documentation](#full-documentation)

---

You will be able to combine any (and all) of these options
for your queue!


## Queuing

It's very easy to push tasks into the queue.

```js
var q = new Queue(fn);
q.push(1);
q.push({ x: 1, y: 2 });
q.push("hello");
```

You can also include a callback as a second parameter to the push
function, which would be called when that task is done. For example:

```js
var q = new Queue(fn);
q.push(1, function (err, result) {
  // Results from the task!
});
```

You can also listen to events on the results of the `push` call.

```js
var q = new Queue(fn);
q.push(1)
  .on('done', function (result) {
    // Task succeeded with {result}!
  })
  .on('fail', function (err) {
    // Task failed!
  })
```

Alternatively, you can subscribe to the queue's events.

```js
var q = new Queue(fn);
q.on('task_finish', function (taskId, result) {
  // taskId = 1, result: 3
  // taskId = 2, result: 5
})
q.on('task_failed', function (taskId, err) {
  // Handle error
})
q.on('empty', function (){})
q.on('drain', function (){})
q.push({ id: 1, a: 1, b: 2 });
q.push({ id: 2, a: 2, b: 3 });
```

`empty` event fires when all of the tasks have been pulled off of
the queue (there may still be tasks running!)

`drain` event fires when there are no more tasks on the queue _and_
when no more tasks are running.

You can control how many tasks process at the same time.

```js
var q = new Queue(fn, { concurrent: 3 })
```

Now the queue will allow 3 tasks running at the same time. (By 
default, we handle tasks one at a time.)

You can also turn the queue into a stack by turning on `filo`.

```js
var q = new Queue(fn, { filo: true })
```

Now items you push on will be handled first.



[back to top](#table-of-contents)

---

## Task Management

#### Task ID

Tasks can be given an ID to help identify and track it as it goes through
the queue.

By default, we look for `task.id` to see if it's a string property,
otherwise we generate a random ID for the task.

You can pass in an `id` property to options to change this behaviour.
Here are some examples of how:

```js
var q = new Queue(fn, {
  id: 'id',   // Default: task's `id` property
  id: 'name', // task's `name` property
  id: function (task, cb) {
    // Compute the ID
    cb(null, 'computed_id');
  }
})
```

One thing you can do with Task ID is merge tasks:

```js
var counter = new Queue(function (task, cb) {
  console.log("I have %d %ss.", task.count, task.id);
  cb();
}, {
  merge: function (oldTask, newTask, cb) {
    oldTask.count += newTask.count;
    cb(null, oldTask);
  }
})
counter.push({ id: 'apple', count: 2 });
counter.push({ id: 'apple', count: 1 });
counter.push({ id: 'orange', count: 1 });
counter.push({ id: 'orange', count: 1 });
// Prints out:
//   I have 3 apples.
//   I have 2 oranges.
```

By default, if tasks have the same ID they replace the previous task.

```js
var counter = new Queue(function (task, cb) {
  console.log("I have %d %ss.", task.count, task.id);
  cb();
})
counter.push({ id: 'apple', count: 1 });
counter.push({ id: 'apple', count: 3 });
counter.push({ id: 'orange', count: 1 });
counter.push({ id: 'orange', count: 2 });
// Prints out:
//   I have 3 apples.
//   I have 2 oranges.
```

You can also use the task ID when subscribing to events from Queue.

```js
var counter = new Queue(fn)
counter.on('task_finish', function (taskId, result) {
  // taskId will be 'jim' or 'bob'
})
counter.push({ id: 'jim', count: 2 });
counter.push({ id: 'bob', count: 1 });
```


#### Batch Processing

Your processing function can also be modified to handle multiple
tasks at the same time. For example:

```js
var ages = new Queue(function (batch, cb) {
  // Batch 1:
  //   [ { id: 'steve', age: 21 },
  //     { id: 'john', age: 34 },
  //     { id: 'joe', age: 18 } ]
  // Batch 2:
  //   [ { id: 'mary', age: 23 } ]
  cb();
}, { batchSize: 3 })
ages.push({ id: 'steve', age: 21 });
ages.push({ id: 'john', age: 34 });
ages.push({ id: 'joe', age: 18 });
ages.push({ id: 'mary', age: 23 });
```

Note how the queue will only handle at most 3 items at a time.

Below is another example of a batched call with numbers.

```js
var ages = new Queue(function (batch, cb) {
  // batch = [1,2,3]
  cb();
}, { batchSize: 3 })
ages.push(1);
ages.push(2);
ages.push(3);
```


#### Filtering, Validation and Priority

You can also format (and filter) the input that arrives from a push
before it gets processed by the queue by passing in a `filter` 
function.

```js
var greeter = new Queue(function (name, cb) {
  console.log("Hello, %s!", name)
  cb();
}, {
  filter: function (input, cb) {
    if (input === 'Bob') {
      return cb('not_allowed');
    }
    return cb(null, input.toUpperCase())
  }
});
greeter.push('anna'); // Prints 'Hello, ANNA!'
```

This can be particularly useful if your queue needs to do some pre-processing,
input validation, database lookup, etc. before you load it onto the queue.

You can also define a priority function to control which tasks get
processed first.

```js
var greeter = new Queue(function (name, cb) {
  console.log("Greetings, %s.", name);
  cb();
}, {
  priority: function (name, cb) {
    if (name === "Steve") return cb(null, 10);
    if (name === "Mary") return cb(null, 5);
    if (name === "Joe") return cb(null, 5);
    cb(null, 1);
  }
})
greeter.push("Steve");
greeter.push("John");
greeter.push("Joe");
greeter.push("Mary");

// Prints out:
//   Greetings, Steve.
//   Greetings, Joe.
//   Greetings, Mary.
//   Greetings, John.
```

If `filo` is set to `true` in the example above, then Joe and Mary 
would swap order.


#### Retry

You can set tasks to retry `maxRetries` times if they fail. By default,
tasks will fail (and will not retry.)

```js
var q = new Queue(fn, { maxRetries: 10 })
```


[back to top](#table-of-contents)

---

## Timing

You can configure the queue to have a `maxTimeout`.

```js
var q = new Queue(function (name, cb) {
  someLongTask(function () {
    cb();
  })
}, { maxTimeout: 2000 })
```

After 2 seconds, the process will throw an error instead of waiting for the
callback to finish.

You can also delay the queue before it starts its processing. This is the 
behaviour of a timed cargo.

```js
var q = new Queue(function (batch, cb) {
  // Batch [1,2] will process after 2s.
  cb();
}, { batchSize: 5, processDelay: 2000 })
q.push(1);
setTimeout(function () {
  q.push(2);
}, 1000)
```

You can also set `idleTimeout`, which will delay processing between tasks.

```js
var q = new Queue(function (task, cb) {
  cb(); // Will wait 1 second before taking the next task
}, { idleTimeout: 1000 })
q.push(1);
q.push(2);
```

[back to top](#table-of-contents)

---

## Control Flow

There are options to control processes while they are running.

You can return an object in your processing function with the functions
`cancel`, `pause` and `resume`. This will allow operations to pause, resume 
or cancel while it's running.

```js
var uploader = new Queue(function (file, cb) {
  
  var worker = someLongProcess(file);

  return {
    cancel: function () {
      // Cancel the file upload
    },
    pause: function () {
      // Pause the file upload
    },
    resume: function () {
      // Resume the file upload
    }
  }
})
uploader.push('/path/to/file.pdf');
uploader.pause();
uploader.resume();
```

You can also set `cancelIfRunning` to `true`. This will cancel a running task if
a task with the same ID is pushed onto the queue.

```js
var uploader = new Queue(function (file, cb) {
  var request = someLongProcess(file);
  return {
    cancel: function () {
      request.cancel();
    }
  }
}, {
  id: 'path',
  cancelIfRunning: true
})
uploader.push({ path: '/path/to/file.pdf' });
// ... Some time later
uploader.push({ path: '/path/to/file.pdf' });
```

In the example above, the first upload process is cancelled and the task is requeued.

Note that if you enable this option in batch mode, it will cancel the entire batch!


[back to top](#table-of-contents)

---

## Status Updates

#### Progress/Finish/Fail

The process function will be run in a context with `progress`,
`finish` and `failed` functions.

The example below illustrates how you can use these:

```js
var uploader = new Queue(function (file, cb) {
  this.failed('some_error')
  this.finish(result)
  this.progress(bytesUploaded, totalBytes)
});
uploader.on('task_finish', function (taskId, result) {
  // Handle finished result
})
uploader.on('task_failed', function (taskId, errorMessage) {
  // Handle error
})
uploader.on('task_progress', function (taskId, completed, total) {
  // Handle task progress
})

uploader.push('/some/file.jpg')
  .on('finish', function (result) {
    // Handle upload result
  })
  .on('failed', function (err) {
    // Handle error
  })
  .on('progress', function (progress) {
    // progress.eta - human readable string estimating time remaining
    // progress.pct - % complete (out of 100)
    // progress.current - # completed so far
    // progress.total - # for completion
  })
```

#### Update Status in Batch mode (batchSize > 1)

You can add the array index to the beginning of params to update the status 
of a task in the batch.

```js
var uploader = new Queue(function (files, cb) {
  this.failed(0, 'some_error') // files[0] has failed with 'some_error'
  this.finish(1, result)       // files[1] has finished with {result}
  this.progress(2, 30, 100)    // files[2] is 30% complete
}, { batchSize: 3 });
uploader.push('/some/file1.jpg')
uploader.push('/some/file2.jpg')
uploader.push('/some/file3.jpg')
```

Note that you may also use the functions _without_ specifying the array index
when in batch mode. In that case, the status would apply to all items within
the batch.

[back to top](#table-of-contents)

---


## Storage


#### Using a store

For your convenience, we have added compatibility for a few storage options.

By default, we are using an in-memory store that doesn't persist. You can change
to one of our other built in stores by passing in the `store` option.

```js
var q = new Queue(fn, {
  store: {
    type: "sqlite",
    path: "/path/to/db"
  }
});
```

The type is one of the types listed below, and the rest of the object is passed
to the store as options.


#### Built-in store

Currently, we support the following stores:

 - memory

Please help us add support for more stores; contributions are welcome!

#### Custom Store

Writing your own store is very easy; you just need to implement a few functions
then call `queue.use(store)` on your store.

```js
var q = new Queue(fn, { store: myStore });
```

or

```js
q.use(myStore);
```

Your store needs the following functions:
```js
q.use({
  connect: function (cb) {
    // Connect to your db
  },
  getTask: function (taskId, cb) {
    // Retrieves a task
  },
  putTask: function (taskId, task, priority, cb) {
    // Save task with given priority
  },
  takeFirstN: function (n, cb) {
    // Removes the first N items (sorted by priority and age)
  },
  takeLastN: function (n, cb) {
    // Removes the last N items (sorted by priority and recency)
  }
})
```

[back to top](#table-of-contents)

---

## Full Documentation

