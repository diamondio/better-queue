# Better Queue - Powerful flow control

[![npm package](https://nodei.co/npm/better-queue.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/better-queue/)

[![Build status](https://img.shields.io/travis/leanderlee/better-queue.svg?style=flat-square)](https://travis-ci.org/leanderlee/better-queue)
[![Dependency Status](https://img.shields.io/david/leanderlee/better-queue.svg?style=flat-square)](https://david-dm.org/leanderlee/better-queue)
[![Known Vulnerabilities](https://snyk.io/test/npm/better-queue/badge.svg?style=flat-square)](https://snyk.io/test/npm/better-queue)
[![Gitter](https://img.shields.io/badge/gitter-join_chat-blue.svg?style=flat-square)](https://gitter.im/leanderlee/better-queue?utm_source=badge)


## Super simple to use

Better Queue is designed to be simple to set up but still let you do complex things.

```js
var Queue = require('better-queue');
var q = new Queue(function (n, cb) {
  cb(null, n+1);
})
q.push(1, function (err, result) {
  // result is 2
})
```

## Table of contents

- [Setting Up](#setting-up-the-queue)
- [Tasks](#tasks)
- [Timing](#timing)
- [Storage](#storage)
- [Full Documentation](#full-documentation)

---

You will be able to combine any (and all) of these options
for your queue!


## Setting up the queue

You can control how many tasks happen at the same time.

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

## Tasks

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
  .on('progress', function (err, progress) {
    // progress.eta - human readable string estimating time remaining
    // progress.pct - % complete (out of 100)
    // progress.current - # completed so far
    // progress.total - # for completion
  })
  .on('done', function (result) {
    // Task succeeded with {result}!
  })
  .on('fail', function (err) {
    // Task failed!
  })
```


Alternatively, you can subscribe to the queue's events.

```js
var q = new Queue(function (task, cb) {
  cb(null, task.a + task.b);
});
q.on('task_finish', function (taskId, result) {
  // taskId = 1, result: 3
  // taskId = 2, result: 5
})
q.push({ id: 1, a: 1, b: 2 });
q.push({ id: 2, a: 2, b: 3 });
```

If the task failed for whatever reason; you can return an error
in the callback.

```js
var q = new Queue(function (task, cb) {
  cb("failed");
});
q.on('task_failed', function (taskId, err) {
  // taskId = 1, err: "failed"
})
q.push("some_task");
```

You tasks are identified by an ID. If the task is not an object, or
if the task doesn't have an `id` property, 


## Batched Queues

You can also handle many items at once.

```js
var q = new Queue(fn, { batchSize: 3 })
```

And now, if you push items onto the queue, `fn` will be an object
where the key is the task ID.


- filter function
- merge function
- cancelIfRunning

#### Processing Tasks

- process function
- maxRetries
- failed
- finish
- progress
- drain and empty


[back to top](#table-of-contents)

---

## Ordering

- fifo vs filo
- priority function


[back to top](#table-of-contents)

---

## Timing

- processDelay
- processTimeout
- idleTimeout

[back to top](#table-of-contents)

---

## Storage

- store

[back to top](#table-of-contents)

---

## Full Documentation


You can add options by passing in a second parameter, like so:

```js
var Queue = require('better-queue');
var q = new Queue(function (n, cb) {
  cb(null, n+1);
}, {
  
})
q.push(1, function (err, result) {
  // result is 2
})
```