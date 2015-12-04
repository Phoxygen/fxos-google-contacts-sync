/**
 * Utility object to have a while-loop like behaviour when the while condition
 * is the result of an async process.
 *
 * Usage:
 * - pass a generator to asynWhileLoop containing the while.
 *
 * asyncWhileController(function *() {
 *   var condition = true;
 *   while(condition) {
 *     condition = yield asyncProcess();
 *   }
 * }).then(() => {
 *  // continue execution
 * });
 *
 * asyncProcess MUST return a promise that resolve to whatever value you want to
 * test in the while condition.
 *
 * asyncWhileController returns a promise that resolves when the while loop is
 * finished or reject with any error it encounters.
 *
 */
window.asyncWhileController = function (generator) {
    // wraps a promise for syntactic sweetness.
  var deferred = {};
  deferred.promise = new  Promise(function (resolve, reject) {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  //
  var iterator = generator();

  /**
   * The recursion happens here. This function:
   * - calls next on the generator.
   * - get the promise yielded by the generator
   * - calls itself when the promise resolves, until the generator is done.
   */
  function advancer(value) {
    // unwrap the promise we got on previous iteration
    var result = iterator.next(value);
    if (!result.done) {
      result.value.then((computedValue) => {
        advancer(computedValue);
      }).catch(deferred.reject); // simple error management: forward any error we have.
    } else {
      deferred.resolve('done');
    }
  }

  // initiate the recursion.
  advancer();

  // promise that is resolved when the generator is done.
  return deferred.promise;
};

