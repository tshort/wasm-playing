// Copyright 2010 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(Module) { ..generated code.. }
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = typeof Module !== 'undefined' ? Module : {};

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)
// {{PRE_JSES}}

// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = {};
var key;
for (key in Module) {
  if (Module.hasOwnProperty(key)) {
    moduleOverrides[key] = Module[key];
  }
}

Module['arguments'] = [];
Module['thisProgram'] = './this.program';
Module['quit'] = function(status, toThrow) {
  throw toThrow;
};
Module['preRun'] = [];
Module['postRun'] = [];

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).

var ENVIRONMENT_IS_WEB = false;
var ENVIRONMENT_IS_WORKER = false;
var ENVIRONMENT_IS_NODE = false;
var ENVIRONMENT_IS_SHELL = false;
ENVIRONMENT_IS_WEB = typeof window === 'object';
ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
ENVIRONMENT_IS_NODE = typeof process === 'object' && typeof require === 'function' && !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_WORKER;
ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

if (Module['ENVIRONMENT']) {
  throw new Error('Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -s ENVIRONMENT=web or -s ENVIRONMENT=node)');
}


// Three configurations we can be running in:
// 1) We could be the application main() thread running in the main JS UI thread. (ENVIRONMENT_IS_WORKER == false and ENVIRONMENT_IS_PTHREAD == false)
// 2) We could be the application main() thread proxied to worker. (with Emscripten -s PROXY_TO_WORKER=1) (ENVIRONMENT_IS_WORKER == true, ENVIRONMENT_IS_PTHREAD == false)
// 3) We could be an application pthread running in a worker. (ENVIRONMENT_IS_WORKER == true and ENVIRONMENT_IS_PTHREAD == true)




// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = '';
function locateFile(path) {
  if (Module['locateFile']) {
    return Module['locateFile'](path, scriptDirectory);
  } else {
    return scriptDirectory + path;
  }
}

if (ENVIRONMENT_IS_NODE) {
  scriptDirectory = __dirname + '/';

  // Expose functionality in the same simple way that the shells work
  // Note that we pollute the global namespace here, otherwise we break in node
  var nodeFS;
  var nodePath;

  Module['read'] = function shell_read(filename, binary) {
    var ret;
      if (!nodeFS) nodeFS = require('fs');
      if (!nodePath) nodePath = require('path');
      filename = nodePath['normalize'](filename);
      ret = nodeFS['readFileSync'](filename);
    return binary ? ret : ret.toString();
  };

  Module['readBinary'] = function readBinary(filename) {
    var ret = Module['read'](filename, true);
    if (!ret.buffer) {
      ret = new Uint8Array(ret);
    }
    assert(ret.buffer);
    return ret;
  };

  if (process['argv'].length > 1) {
    Module['thisProgram'] = process['argv'][1].replace(/\\/g, '/');
  }

  Module['arguments'] = process['argv'].slice(2);

  if (typeof module !== 'undefined') {
    module['exports'] = Module;
  }

  process['on']('uncaughtException', function(ex) {
    // suppress ExitStatus exceptions from showing an error
    if (!(ex instanceof ExitStatus)) {
      throw ex;
    }
  });
  // Currently node will swallow unhandled rejections, but this behavior is
  // deprecated, and in the future it will exit with error status.
  process['on']('unhandledRejection', abort);

  Module['quit'] = function(status) {
    process['exit'](status);
  };

  Module['inspect'] = function () { return '[Emscripten Module object]'; };
} else
if (ENVIRONMENT_IS_SHELL) {


  if (typeof read != 'undefined') {
    Module['read'] = function shell_read(f) {
      return read(f);
    };
  }

  Module['readBinary'] = function readBinary(f) {
    var data;
    if (typeof readbuffer === 'function') {
      return new Uint8Array(readbuffer(f));
    }
    data = read(f, 'binary');
    assert(typeof data === 'object');
    return data;
  };

  if (typeof scriptArgs != 'undefined') {
    Module['arguments'] = scriptArgs;
  } else if (typeof arguments != 'undefined') {
    Module['arguments'] = arguments;
  }

  if (typeof quit === 'function') {
    Module['quit'] = function(status) {
      quit(status);
    }
  }
} else
if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  if (ENVIRONMENT_IS_WORKER) { // Check worker, not web, since window could be polyfilled
    scriptDirectory = self.location.href;
  } else if (document.currentScript) { // web
    scriptDirectory = document.currentScript.src;
  }
  // blob urls look like blob:http://site.com/etc/etc and we cannot infer anything from them.
  // otherwise, slice off the final part of the url to find the script directory.
  // if scriptDirectory does not contain a slash, lastIndexOf will return -1,
  // and scriptDirectory will correctly be replaced with an empty string.
  if (scriptDirectory.indexOf('blob:') !== 0) {
    scriptDirectory = scriptDirectory.substr(0, scriptDirectory.lastIndexOf('/')+1);
  } else {
    scriptDirectory = '';
  }


  Module['read'] = function shell_read(url) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send(null);
      return xhr.responseText;
  };

  if (ENVIRONMENT_IS_WORKER) {
    Module['readBinary'] = function readBinary(url) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.responseType = 'arraybuffer';
        xhr.send(null);
        return new Uint8Array(xhr.response);
    };
  }

  Module['readAsync'] = function readAsync(url, onload, onerror) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function xhr_onload() {
      if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
        onload(xhr.response);
        return;
      }
      onerror();
    };
    xhr.onerror = onerror;
    xhr.send(null);
  };

  Module['setWindowTitle'] = function(title) { document.title = title };
} else
{
  throw new Error('environment detection error');
}

// Set up the out() and err() hooks, which are how we can print to stdout or
// stderr, respectively.
// If the user provided Module.print or printErr, use that. Otherwise,
// console.log is checked first, as 'print' on the web will open a print dialogue
// printErr is preferable to console.warn (works better in shells)
// bind(console) is necessary to fix IE/Edge closed dev tools panel behavior.
var out = Module['print'] || (typeof console !== 'undefined' ? console.log.bind(console) : (typeof print !== 'undefined' ? print : null));
var err = Module['printErr'] || (typeof printErr !== 'undefined' ? printErr : ((typeof console !== 'undefined' && console.warn.bind(console)) || out));

// Merge back in the overrides
for (key in moduleOverrides) {
  if (moduleOverrides.hasOwnProperty(key)) {
    Module[key] = moduleOverrides[key];
  }
}
// Free the object hierarchy contained in the overrides, this lets the GC
// reclaim data used e.g. in memoryInitializerRequest, which is a large typed array.
moduleOverrides = undefined;

// perform assertions in shell.js after we set up out() and err(), as otherwise if an assertion fails it cannot print the message
assert(typeof Module['memoryInitializerPrefixURL'] === 'undefined', 'Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['pthreadMainPrefixURL'] === 'undefined', 'Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['cdInitializerPrefixURL'] === 'undefined', 'Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['filePackagePrefixURL'] === 'undefined', 'Module.filePackagePrefixURL option was removed, use Module.locateFile instead');



// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// {{PREAMBLE_ADDITIONS}}

var STACK_ALIGN = 16;

// stack management, and other functionality that is provided by the compiled code,
// should not be used before it is ready
stackSave = stackRestore = stackAlloc = function() {
  abort('cannot use the stack before compiled code is ready to run, and has provided stack access');
};

function staticAlloc(size) {
  abort('staticAlloc is no longer available at runtime; instead, perform static allocations at compile time (using makeStaticAlloc)');
}

function dynamicAlloc(size) {
  assert(DYNAMICTOP_PTR);
  var ret = HEAP32[DYNAMICTOP_PTR>>2];
  var end = (ret + size + 15) & -16;
  if (end <= _emscripten_get_heap_size()) {
    HEAP32[DYNAMICTOP_PTR>>2] = end;
  } else {
    var success = _emscripten_resize_heap(end);
    if (!success) return 0;
  }
  return ret;
}

function alignMemory(size, factor) {
  if (!factor) factor = STACK_ALIGN; // stack alignment (16-byte) by default
  return Math.ceil(size / factor) * factor;
}

function getNativeTypeSize(type) {
  switch (type) {
    case 'i1': case 'i8': return 1;
    case 'i16': return 2;
    case 'i32': return 4;
    case 'i64': return 8;
    case 'float': return 4;
    case 'double': return 8;
    default: {
      if (type[type.length-1] === '*') {
        return 4; // A pointer
      } else if (type[0] === 'i') {
        var bits = parseInt(type.substr(1));
        assert(bits % 8 === 0, 'getNativeTypeSize invalid bits ' + bits + ', type ' + type);
        return bits / 8;
      } else {
        return 0;
      }
    }
  }
}

function warnOnce(text) {
  if (!warnOnce.shown) warnOnce.shown = {};
  if (!warnOnce.shown[text]) {
    warnOnce.shown[text] = 1;
    err(text);
  }
}

var asm2wasmImports = { // special asm2wasm imports
    "f64-rem": function(x, y) {
        return x % y;
    },
    "debugger": function() {
        debugger;
    }
};

// dynamic linker/loader (a-la ld.so on ELF systems)
var LDSO = {
  // next free handle to use for a loaded dso.
  // (handle=0 is avoided as it means "error" in dlopen)
  nextHandle: 1,

  loadedLibs: {         // handle -> dso [refcount, name, module, global]
    // program itself
    // XXX uglifyjs fails on "[-1]: {"
    '-1': {
      refcount: Infinity,   // = nodelete
      name:     '__self__',
      module:   Module,
      global:   true
    }
  },

  loadedLibNames: {     // name   -> handle
    // program itself
    '__self__': -1
  },
}

// fetchBinary fetches binaray data @ url. (async)
function fetchBinary(url) {
  return fetch(url, { credentials: 'same-origin' }).then(function(response) {
    if (!response['ok']) {
      throw "failed to load binary file at '" + url + "'";
    }
    return response['arrayBuffer']();
  }).then(function(buffer) {
    return new Uint8Array(buffer);
  });
}

// loadDynamicLibrary loads dynamic library @ lib URL / path and returns handle for loaded DSO.
//
// Several flags affect the loading:
//
// - if flags.global=true, symbols from the loaded library are merged into global
//   process namespace. Flags.global is thus similar to RTLD_GLOBAL in ELF.
//
// - if flags.nodelete=true, the library will be never unloaded. Flags.nodelete
//   is thus similar to RTLD_NODELETE in ELF.
//
// - if flags.loadAsync=true, the loading is performed asynchronously and
//   loadDynamicLibrary returns corresponding promise.
//
// - if flags.fs is provided, it is used as FS-like interface to load library data.
//   By default, when flags.fs=undefined, native loading capabilities of the
//   environment are used.
//
// If a library was already loaded, it is not loaded a second time. However
// flags.global and flags.nodelete are handled every time a load request is made.
// Once a library becomes "global" or "nodelete", it cannot be removed or unloaded.
function loadDynamicLibrary(lib, flags) {
  // when loadDynamicLibrary did not have flags, libraries were loaded globally & permanently
  flags = flags || {global: true, nodelete: true}

  var handle = LDSO.loadedLibNames[lib];
  var dso;
  if (handle) {
    // the library is being loaded or has been loaded already.
    //
    // however it could be previously loaded only locally and if we get
    // load request with global=true we have to make it globally visible now.
    dso = LDSO.loadedLibs[handle];
    if (flags.global && !dso.global) {
      dso.global = true;
      if (dso.module !== 'loading') {
        // ^^^ if module is 'loading' - symbols merging will be eventually done by the loader.
        mergeLibSymbols(dso.module)
      }
    }
    // same for "nodelete"
    if (flags.nodelete && dso.refcount !== Infinity) {
      dso.refcount = Infinity;
    }
    dso.refcount++
    return flags.loadAsync ? Promise.resolve(handle) : handle;
  }

  // allocate new DSO & handle
  handle = LDSO.nextHandle++;
  dso = {
    refcount: flags.nodelete ? Infinity : 1,
    name:     lib,
    module:   'loading',
    global:   flags.global,
  };
  LDSO.loadedLibNames[lib] = handle;
  LDSO.loadedLibs[handle] = dso;

  // libData <- lib
  function loadLibData() {
    // for wasm, we can use fetch for async, but for fs mode we can only imitate it
    if (flags.fs) {
      var libData = flags.fs.readFile(lib, {encoding: 'binary'});
      if (!(libData instanceof Uint8Array)) {
        libData = new Uint8Array(lib_data);
      }
      return flags.loadAsync ? Promise.resolve(libData) : libData;
    }

    if (flags.loadAsync) {
      return fetchBinary(lib);
    }
    // load the binary synchronously
    return Module['readBinary'](lib);
  }

  // libModule <- libData
  function createLibModule(libData) {
    return loadWebAssemblyModule(libData, flags)
  }

  // libModule <- lib
  function getLibModule() {
    // lookup preloaded cache first
    if (Module['preloadedWasm'] !== undefined &&
        Module['preloadedWasm'][lib] !== undefined) {
      var libModule = Module['preloadedWasm'][lib];
      return flags.loadAsync ? Promise.resolve(libModule) : libModule;
    }

    // module not preloaded - load lib data and create new module from it
    if (flags.loadAsync) {
      return loadLibData(lib).then(function(libData) {
        return createLibModule(libData);
      });
    }

    return createLibModule(loadLibData(lib));
  }

  // Module.symbols <- libModule.symbols (flags.global handler)
  function mergeLibSymbols(libModule) {
    // add symbols into global namespace TODO: weak linking etc.
    for (var sym in libModule) {
      if (!libModule.hasOwnProperty(sym)) {
        continue;
      }

      // When RTLD_GLOBAL is enable, the symbols defined by this shared object will be made
      // available for symbol resolution of subsequently loaded shared objects.
      //
      // We should copy the symbols (which include methods and variables) from SIDE_MODULE to MAIN_MODULE.

      var module_sym = sym;
      // Module of SIDE_MODULE has not only the symbols (which should be copied)
      // but also others (print*, asmGlobal*, FUNCTION_TABLE_**, NAMED_GLOBALS, and so on).
      //
      // When the symbol (which should be copied) is method, Module.* 's type becomes function.
      // When the symbol (which should be copied) is variable, Module.* 's type becomes number.
      // Except for the symbol prefix (_), there is no difference in the symbols (which should be copied) and others.
      // So this just copies over compiled symbols (which start with _).
      if (sym[0] !== '_') {
        continue;
      }

      if (!Module.hasOwnProperty(module_sym)) {
        Module[module_sym] = libModule[sym];
      }
      else {
        var curr = Module[sym], next = libModule[sym];
        // don't warn on functions - might be odr, linkonce_odr, etc.
        if (!(typeof curr === 'function' && typeof next === 'function')) {
          err("warning: symbol '" + sym + "' from '" + lib + "' already exists (duplicate symbol? or weak linking, which isn't supported yet?)"); // + [curr, ' vs ', next]);
        }
      }
    }
  }

  // module for lib is loaded - update the dso & global namespace
  function moduleLoaded(libModule) {
    if (dso.global) {
      mergeLibSymbols(libModule);
    }
    dso.module = libModule;
  }

  if (flags.loadAsync) {
    return getLibModule().then(function(libModule) {
      moduleLoaded(libModule);
      return handle;
    })
  }

  moduleLoaded(getLibModule());
  return handle;
}

// Loads a side module from binary data
function loadWebAssemblyModule(binary, flags) {
  var int32View = new Uint32Array(new Uint8Array(binary.subarray(0, 24)).buffer);
  assert(int32View[0] == 0x6d736100, 'need to see wasm magic number'); // \0asm
  // we should see the dylink section right after the magic number and wasm version
  assert(binary[8] === 0, 'need the dylink section to be first')
  var next = 9;
  function getLEB() {
    var ret = 0;
    var mul = 1;
    while (1) {
      var byte = binary[next++];
      ret += ((byte & 0x7f) * mul);
      mul *= 0x80;
      if (!(byte & 0x80)) break;
    }
    return ret;
  }
  var sectionSize = getLEB();
  assert(binary[next] === 6);                 next++; // size of "dylink" string
  assert(binary[next] === 'd'.charCodeAt(0)); next++;
  assert(binary[next] === 'y'.charCodeAt(0)); next++;
  assert(binary[next] === 'l'.charCodeAt(0)); next++;
  assert(binary[next] === 'i'.charCodeAt(0)); next++;
  assert(binary[next] === 'n'.charCodeAt(0)); next++;
  assert(binary[next] === 'k'.charCodeAt(0)); next++;
  var memorySize = getLEB();
  var memoryAlign = getLEB();
  var tableSize = getLEB();
  var tableAlign = getLEB();

  // shared libraries this module needs. We need to load them first, so that
  // current module could resolve its imports. (see tools/shared.py
  // WebAssembly.make_shared_library() for "dylink" section extension format)
  var neededDynlibsCount = getLEB();
  var neededDynlibs = [];
  for (var i = 0; i < neededDynlibsCount; ++i) {
    var nameLen = getLEB();
    var nameUTF8 = binary.subarray(next, next + nameLen);
    next += nameLen;
    var name = UTF8ArrayToString(nameUTF8, 0);
    neededDynlibs.push(name);
  }

  // loadModule loads the wasm module after all its dependencies have been loaded.
  // can be called both sync/async.
  function loadModule() {
    // alignments are powers of 2
    memoryAlign = Math.pow(2, memoryAlign);
    tableAlign = Math.pow(2, tableAlign);
    // finalize alignments and verify them
    memoryAlign = Math.max(memoryAlign, STACK_ALIGN); // we at least need stack alignment
    assert(tableAlign === 1, 'invalid tableAlign ' + tableAlign);
    // prepare memory
    var memoryBase = alignMemory(getMemory(memorySize + memoryAlign), memoryAlign); // TODO: add to cleanups
    // The static area consists of explicitly initialized data, followed by zero-initialized data.
    // The latter may need zeroing out if the MAIN_MODULE has already used this memory area before
    // dlopen'ing the SIDE_MODULE.  Since we don't know the size of the explicitly initialized data
    // here, we just zero the whole thing, which is suboptimal, but should at least resolve bugs
    // from uninitialized memory.
    for (var i = memoryBase; i < memoryBase + memorySize; ++i) HEAP8[i] = 0;
    // prepare env imports
    var env = asmLibraryArg;
    // TODO: use only __memory_base and __table_base, need to update asm.js backend
    var table = wasmTable;
    var tableBase = table.length;
    var originalTable = table;
    table.grow(tableSize);
    assert(table === originalTable);
    // zero-initialize memory and table
    // TODO: in some cases we can tell it is already zero initialized
    for (var i = memoryBase; i < memoryBase + memorySize; i++) {
      HEAP8[i] = 0;
    }
    for (var i = tableBase; i < tableBase + tableSize; i++) {
      table.set(i, null);
    }

    // We resolve symbols against the global Module but failing that also
    // against the local symbols exported a side module.  This is because
    // a) Module sometime need to import their own symbols
    // b) Symbols from loaded modules are not always added to the global Module.
    var moduleLocal = {};

    var resolveSymbol = function(sym, type) {
      var resolved = Module[sym];
      if (!resolved)
        resolved = moduleLocal[sym];
      assert(resolved, 'missing linked ' + type + ' `' + sym + '`. perhaps a side module was not linked in? if this global was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment');
      return resolved;
    }

    // copy currently exported symbols so the new module can import them
    for (var x in Module) {
      if (!(x in env)) {
        env[x] = Module[x];
      }
    }

    // TODO kill ↓↓↓ (except "symbols local to this module", it will likely be
    // not needed if we require that if A wants symbols from B it has to link
    // to B explicitly: similarly to -Wl,--no-undefined)
    //
    // wasm dynamic libraries are pure wasm, so they cannot assist in
    // their own loading. When side module A wants to import something
    // provided by a side module B that is loaded later, we need to
    // add a layer of indirection, but worse, we can't even tell what
    // to add the indirection for, without inspecting what A's imports
    // are. To do that here, we use a JS proxy (another option would
    // be to inspect the binary directly).
    var proxyHandler = {
      'get': function(obj, prop) {
        // symbols that should be local to this module
        switch (prop) {
          case '__memory_base':
          case 'gb':
            return memoryBase;
          case '__table_base':
          case 'fb':
            return tableBase;
        }

        if (prop in obj) {
          return obj[prop]; // already present
        }
        if (prop.startsWith('g$')) {
          // a global. the g$ function returns the global address.
          var name = prop.substr(2); // without g$ prefix
          return obj[prop] = function() {
            return resolveSymbol(name, 'global');
          };
        }
        if (prop.startsWith('fp$')) {
          // the fp$ function returns the address (table index) of the function
          var parts = prop.split('$');
          assert(parts.length == 3)
          var name = parts[1];
          var sig = parts[2];
          var fp = 0;
          return obj[prop] = function() {
            if (!fp) {
              console.log("geting function address: " + name);
              var f = resolveSymbol(name, 'function');
              fp = addFunctionWasm(f, sig);
            }
            return fp;
          };
        }
        if (prop.startsWith('invoke_')) {
          // A missing invoke, i.e., an invoke for a function type
          // present in the dynamic library but not in the main JS,
          // and the dynamic library cannot provide JS for it. Use
          // the generic "X" invoke for it.
          return obj[prop] = invoke_X;
        }
        // otherwise this is regular function import - call it indirectly
        return obj[prop] = function() {
          return resolveSymbol(prop, 'function').apply(null, arguments);
        };
      }
    };
    var info = {
      global: {
        'NaN': NaN,
        'Infinity': Infinity,
      },
      'global.Math': Math,
      env: new Proxy(env, proxyHandler),
      'asm2wasm': asm2wasmImports
    };
    var oldTable = [];
    for (var i = 0; i < tableBase; i++) {
      oldTable.push(table.get(i));
    }

    function postInstantiation(instance, moduleLocal) {
      var exports = {};
      // the table should be unchanged
      assert(table === originalTable);
      assert(table === wasmTable);
      if (instance.exports['table']) {
        assert(table === instance.exports['table']);
      }
      // the old part of the table should be unchanged
      for (var i = 0; i < tableBase; i++) {
        assert(table.get(i) === oldTable[i], 'old table entries must remain the same');
      }
      // verify that the new table region was filled in
      for (var i = 0; i < tableSize; i++) {
        assert(table.get(tableBase + i) !== undefined, 'table entry was not filled in');
      }
      for (var e in instance.exports) {
        var value = instance.exports[e];
        if (typeof value === 'object') {
          // a breaking change in the wasm spec, globals are now objects
          // https://github.com/WebAssembly/mutable-global/issues/1
          value = value.value;
        }
        if (typeof value === 'number') {
          // relocate it - modules export the absolute value, they can't relocate before they export
            value = value + memoryBase;
        }
        exports[e] = value;
        moduleLocal[e] = value;
      }
      // initialize the module
      var init = exports['__post_instantiate'];
      if (init) {
        if (runtimeInitialized) {
          init();
        } else {
          // we aren't ready to run compiled code yet
          __ATINIT__.push(init);
        }
      }
      return exports;
    }

    if (flags.loadAsync) {
      return WebAssembly.instantiate(binary, info).then(function(result) {
        return postInstantiation(result.instance, moduleLocal);
      });
    } else {
      var instance = new WebAssembly.Instance(new WebAssembly.Module(binary), info);
      return postInstantiation(instance, moduleLocal);
    }
  }

  // now load needed libraries and the module itself.
  if (flags.loadAsync) {
    return Promise.all(neededDynlibs.map(function(dynNeeded) {
      return loadDynamicLibrary(dynNeeded, flags);
    })).then(function() {
      return loadModule();
    });
  }

  neededDynlibs.forEach(function(dynNeeded) {
    loadDynamicLibrary(dynNeeded, flags);
  });
  return loadModule();
}
Module['loadWebAssemblyModule'] = loadWebAssemblyModule;



// register functions from a new module being loaded
function registerFunctions(sigs, newModule) {
  sigs.forEach(function(sig) {
    if (!Module['FUNCTION_TABLE_' + sig]) {
      Module['FUNCTION_TABLE_' + sig] = [];
    }
  });
  var oldMaxx = alignFunctionTables(); // align the new tables we may have just added
  var newMaxx = alignFunctionTables(newModule);
  var maxx = oldMaxx + newMaxx;
  sigs.forEach(function(sig) {
    var newTable = newModule['FUNCTION_TABLE_' + sig];
    var oldTable = Module['FUNCTION_TABLE_' + sig];
    assert(newTable !== oldTable);
    assert(oldTable.length === oldMaxx);
    for (var i = 0; i < newTable.length; i++) {
      oldTable.push(newTable[i]);
    }
    assert(oldTable.length === maxx);
  });
  assert(maxx === alignFunctionTables()); // align the ones we didn't touch
}
// export this so side modules can use it
Module['registerFunctions'] = registerFunctions;


// Wraps a JS function as a wasm function with a given signature.
// In the future, we may get a WebAssembly.Function constructor. Until then,
// we create a wasm module that takes the JS function as an import with a given
// signature, and re-exports that as a wasm function.
function convertJsFunctionToWasm(func, sig) {
  // The module is static, with the exception of the type section, which is
  // generated based on the signature passed in.
  var typeSection = [
    0x01, // id: section,
    0x00, // length: 0 (placeholder)
    0x01, // count: 1
    0x60, // form: func
  ];
  var sigRet = sig.slice(0, 1);
  var sigParam = sig.slice(1);
  var typeCodes = {
    'i': 0x7f, // i32
    'j': 0x7e, // i64
    'f': 0x7d, // f32
    'd': 0x7c, // f64
  };

  // Parameters, length + signatures
  typeSection.push(sigParam.length);
  for (var i = 0; i < sigParam.length; ++i) {
    typeSection.push(typeCodes[sigParam[i]]);
  }

  // Return values, length + signatures
  // With no multi-return in MVP, either 0 (void) or 1 (anything else)
  if (sigRet == 'v') {
    typeSection.push(0x00);
  } else {
    typeSection = typeSection.concat([0x01, typeCodes[sigRet]]);
  }

  // Write the overall length of the type section back into the section header
  // (excepting the 2 bytes for the section id and length)
  typeSection[1] = typeSection.length - 2;

  // Rest of the module is static
  var bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // magic ("\0asm")
    0x01, 0x00, 0x00, 0x00, // version: 1
  ].concat(typeSection, [
    0x02, 0x07, // import section
      // (import "e" "f" (func 0 (type 0)))
      0x01, 0x01, 0x65, 0x01, 0x66, 0x00, 0x00,
    0x07, 0x05, // export section
      // (export "f" (func 0 (type 0)))
      0x01, 0x01, 0x66, 0x00, 0x00,
  ]));

   // We can compile this wasm module synchronously because it is very small.
  // This accepts an import (at "e.f"), that it reroutes to an export (at "f")
  var module = new WebAssembly.Module(bytes);
  var instance = new WebAssembly.Instance(module, {
    e: {
      f: func
    }
  });
  var wrappedFunc = instance.exports.f;
  return wrappedFunc;
}

// Add a wasm function to the table.
function addFunctionWasm(func, sig) {
  var table = wasmTable;
  var ret = table.length;

  // Grow the table
  try {
    table.grow(1);
  } catch (err) {
    if (!err instanceof RangeError) {
      throw err;
    }
    throw 'Unable to grow wasm table. Use a higher value for RESERVED_FUNCTION_POINTERS or set ALLOW_TABLE_GROWTH.';
  }

  // Insert new element
  try {
    // Attempting to call this with JS function will cause of table.set() to fail
    table.set(ret, func);
  } catch (err) {
    if (!err instanceof TypeError) {
      throw err;
    }
    assert(typeof sig !== 'undefined', 'Missing signature argument to addFunction');
    var wrapped = convertJsFunctionToWasm(func, sig);
    table.set(ret, wrapped);
  }

  return ret;
}

function removeFunctionWasm(index) {
  // TODO(sbc): Look into implementing this to allow re-using of table slots
}

// 'sig' parameter is required for the llvm backend but only when func is not
// already a WebAssembly function.
function addFunction(func, sig) {
  if (typeof sig === 'undefined') {
    err('warning: addFunction(): You should provide a wasm function signature string as a second argument. This is not necessary for asm.js and asm2wasm, but can be required for the LLVM wasm backend, so it is recommended for full portability.');
  }



  return addFunctionWasm(func, sig);

}

function removeFunction(index) {

  removeFunctionWasm(index);

}

var funcWrappers = {};

function getFuncWrapper(func, sig) {
  if (!func) return; // on null pointer, return undefined
  assert(sig);
  if (!funcWrappers[sig]) {
    funcWrappers[sig] = {};
  }
  var sigCache = funcWrappers[sig];
  if (!sigCache[func]) {
    // optimize away arguments usage in common cases
    if (sig.length === 1) {
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func);
      };
    } else if (sig.length === 2) {
      sigCache[func] = function dynCall_wrapper(arg) {
        return dynCall(sig, func, [arg]);
      };
    } else {
      // general case
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func, Array.prototype.slice.call(arguments));
      };
    }
  }
  return sigCache[func];
}


function makeBigInt(low, high, unsigned) {
  return unsigned ? ((+((low>>>0)))+((+((high>>>0)))*4294967296.0)) : ((+((low>>>0)))+((+((high|0)))*4294967296.0));
}

function dynCall(sig, ptr, args) {
  if (args && args.length) {
    assert(args.length == sig.length-1);
    assert(('dynCall_' + sig) in Module, 'bad function pointer type - no table for sig \'' + sig + '\'');
    return Module['dynCall_' + sig].apply(null, [ptr].concat(args));
  } else {
    assert(sig.length == 1);
    assert(('dynCall_' + sig) in Module, 'bad function pointer type - no table for sig \'' + sig + '\'');
    return Module['dynCall_' + sig].call(null, ptr);
  }
}

var tempRet0 = 0;

var setTempRet0 = function(value) {
  tempRet0 = value;
}

var getTempRet0 = function() {
  return tempRet0;
}

function getCompilerSetting(name) {
  throw 'You must build with -s RETAIN_COMPILER_SETTINGS=1 for getCompilerSetting or emscripten_get_compiler_setting to work';
}

var Runtime = {
  // helpful errors
  getTempRet0: function() { abort('getTempRet0() is now a top-level function, after removing the Runtime object. Remove "Runtime."') },
  staticAlloc: function() { abort('staticAlloc() is now a top-level function, after removing the Runtime object. Remove "Runtime."') },
  stackAlloc: function() { abort('stackAlloc() is now a top-level function, after removing the Runtime object. Remove "Runtime."') },
};

// The address globals begin at. Very low in memory, for code size and optimization opportunities.
// Above 0 is static memory, starting with globals.
// Then the stack.
// Then 'dynamic' memory for sbrk.
var GLOBAL_BASE = 1024;

GLOBAL_BASE = alignMemory(GLOBAL_BASE, 64);



// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html


if (typeof WebAssembly !== 'object') {
  abort('No WebAssembly support found. Build with -s WASM=0 to target JavaScript instead.');
}


/** @type {function(number, string, boolean=)} */
function getValue(ptr, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': return HEAP8[((ptr)>>0)];
      case 'i8': return HEAP8[((ptr)>>0)];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': return HEAP32[((ptr)>>2)];
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      default: abort('invalid type for getValue: ' + type);
    }
  return null;
}




// Wasm globals

var wasmMemory;

// Potentially used for direct table calls.
var wasmTable;


//========================================
// Runtime essentials
//========================================

// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS = 0;

/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed: ' + text);
  }
}

// Returns the C function with a specified identifier (for C++, you need to do manual name mangling)
function getCFunc(ident) {
  var func = Module['_' + ident]; // closure exported function
  assert(func, 'Cannot call unknown function ' + ident + ', make sure it is exported');
  return func;
}

// C calling interface.
function ccall(ident, returnType, argTypes, args, opts) {
  // For fast lookup of conversion functions
  var toC = {
    'string': function(str) {
      var ret = 0;
      if (str !== null && str !== undefined && str !== 0) { // null string
        // at most 4 bytes per UTF-8 code point, +1 for the trailing '\0'
        var len = (str.length << 2) + 1;
        ret = stackAlloc(len);
        stringToUTF8(str, ret, len);
      }
      return ret;
    },
    'array': function(arr) {
      var ret = stackAlloc(arr.length);
      writeArrayToMemory(arr, ret);
      return ret;
    }
  };

  function convertReturnValue(ret) {
    if (returnType === 'string') return UTF8ToString(ret);
    if (returnType === 'boolean') return Boolean(ret);
    return ret;
  }

  var func = getCFunc(ident);
  var cArgs = [];
  var stack = 0;
  assert(returnType !== 'array', 'Return type should not be "array".');
  if (args) {
    for (var i = 0; i < args.length; i++) {
      var converter = toC[argTypes[i]];
      if (converter) {
        if (stack === 0) stack = stackSave();
        cArgs[i] = converter(args[i]);
      } else {
        cArgs[i] = args[i];
      }
    }
  }
  var ret = func.apply(null, cArgs);
  ret = convertReturnValue(ret);
  if (stack !== 0) stackRestore(stack);
  return ret;
}

function cwrap(ident, returnType, argTypes, opts) {
  return function() {
    return ccall(ident, returnType, argTypes, arguments, opts);
  }
}

/** @type {function(number, number, string, boolean=)} */
function setValue(ptr, value, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': HEAP8[((ptr)>>0)]=value; break;
      case 'i8': HEAP8[((ptr)>>0)]=value; break;
      case 'i16': HEAP16[((ptr)>>1)]=value; break;
      case 'i32': HEAP32[((ptr)>>2)]=value; break;
      case 'i64': (tempI64 = [value>>>0,(tempDouble=value,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((ptr)>>2)]=tempI64[0],HEAP32[(((ptr)+(4))>>2)]=tempI64[1]); break;
      case 'float': HEAPF32[((ptr)>>2)]=value; break;
      case 'double': HEAPF64[((ptr)>>3)]=value; break;
      default: abort('invalid type for setValue: ' + type);
    }
}

var ALLOC_NORMAL = 0; // Tries to use _malloc()
var ALLOC_STACK = 1; // Lives for the duration of the current function call
var ALLOC_DYNAMIC = 2; // Cannot be freed except through sbrk
var ALLOC_NONE = 3; // Do not allocate

// allocate(): This is for internal use. You can use it yourself as well, but the interface
//             is a little tricky (see docs right below). The reason is that it is optimized
//             for multiple syntaxes to save space in generated code. So you should
//             normally not use allocate(), and instead allocate memory using _malloc(),
//             initialize it with setValue(), and so forth.
// @slab: An array of data, or a number. If a number, then the size of the block to allocate,
//        in *bytes* (note that this is sometimes confusing: the next parameter does not
//        affect this!)
// @types: Either an array of types, one for each byte (or 0 if no type at that position),
//         or a single type which is used for the entire block. This only matters if there
//         is initial data - if @slab is a number, then this does not matter at all and is
//         ignored.
// @allocator: How to allocate memory, see ALLOC_*
/** @type {function((TypedArray|Array<number>|number), string, number, number=)} */
function allocate(slab, types, allocator, ptr) {
  var zeroinit, size;
  if (typeof slab === 'number') {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }

  var singleType = typeof types === 'string' ? types : null;

  var ret;
  if (allocator == ALLOC_NONE) {
    ret = ptr;
  } else {
    ret = [_malloc,
    stackAlloc,
    dynamicAlloc][allocator](Math.max(size, singleType ? 1 : types.length));
  }

  if (zeroinit) {
    var stop;
    ptr = ret;
    assert((ret & 3) == 0);
    stop = ret + (size & ~3);
    for (; ptr < stop; ptr += 4) {
      HEAP32[((ptr)>>2)]=0;
    }
    stop = ret + size;
    while (ptr < stop) {
      HEAP8[((ptr++)>>0)]=0;
    }
    return ret;
  }

  if (singleType === 'i8') {
    if (slab.subarray || slab.slice) {
      HEAPU8.set(/** @type {!Uint8Array} */ (slab), ret);
    } else {
      HEAPU8.set(new Uint8Array(slab), ret);
    }
    return ret;
  }

  var i = 0, type, typeSize, previousType;
  while (i < size) {
    var curr = slab[i];

    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }
    assert(type, 'Must know what type to store in allocate!');

    if (type == 'i64') type = 'i32'; // special case: we have one i32 here, and one i32 later

    setValue(ret+i, curr, type);

    // no need to look up size unless type changes, so cache it
    if (previousType !== type) {
      typeSize = getNativeTypeSize(type);
      previousType = type;
    }
    i += typeSize;
  }

  return ret;
}

// Allocate memory during any stage of startup - static memory early on, dynamic memory later, malloc when ready
function getMemory(size) {
  if (!runtimeInitialized) return dynamicAlloc(size);
  return _malloc(size);
}




/** @type {function(number, number=)} */
function Pointer_stringify(ptr, length) {
  abort("this function has been removed - you should use UTF8ToString(ptr, maxBytesToRead) instead!");
}

// Given a pointer 'ptr' to a null-terminated ASCII-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

function AsciiToString(ptr) {
  var str = '';
  while (1) {
    var ch = HEAPU8[((ptr++)>>0)];
    if (!ch) return str;
    str += String.fromCharCode(ch);
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in ASCII form. The copy will require at most str.length+1 bytes of space in the HEAP.

function stringToAscii(str, outPtr) {
  return writeAsciiToMemory(str, outPtr, false);
}


// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the given array that contains uint8 values, returns
// a copy of that string as a Javascript String object.

var UTF8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf8') : undefined;

/**
 * @param {number} idx
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ArrayToString(u8Array, idx, maxBytesToRead) {
  var endIdx = idx + maxBytesToRead;
  var endPtr = idx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  // (As a tiny code save trick, compare endPtr against endIdx using a negation, so that undefined means Infinity)
  while (u8Array[endPtr] && !(endPtr >= endIdx)) ++endPtr;

  if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
    return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
  } else {
    var str = '';
    // If building with TextDecoder, we have already computed the string length above, so test loop end condition against that
    while (idx < endPtr) {
      // For UTF8 byte structure, see:
      // http://en.wikipedia.org/wiki/UTF-8#Description
      // https://www.ietf.org/rfc/rfc2279.txt
      // https://tools.ietf.org/html/rfc3629
      var u0 = u8Array[idx++];
      if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
      var u1 = u8Array[idx++] & 63;
      if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
      var u2 = u8Array[idx++] & 63;
      if ((u0 & 0xF0) == 0xE0) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        if ((u0 & 0xF8) != 0xF0) warnOnce('Invalid UTF-8 leading byte 0x' + u0.toString(16) + ' encountered when deserializing a UTF-8 string on the asm.js/wasm heap to a JS string!');
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (u8Array[idx++] & 63);
      }

      if (u0 < 0x10000) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 0x10000;
        str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
      }
    }
  }
  return str;
}

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the emscripten HEAP, returns a
// copy of that string as a Javascript String object.
// maxBytesToRead: an optional length that specifies the maximum number of bytes to read. You can omit
//                 this parameter to scan the string until the first \0 byte. If maxBytesToRead is
//                 passed, and the string at [ptr, ptr+maxBytesToReadr[ contains a null byte in the
//                 middle, then the string will cut short at that byte index (i.e. maxBytesToRead will
//                 not produce a string of exact length [ptr, ptr+maxBytesToRead[)
//                 N.B. mixing frequent uses of UTF8ToString() with and without maxBytesToRead may
//                 throw JS JIT optimizations off, so it is worth to consider consistently using one
//                 style or the other.
/**
 * @param {number} ptr
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ToString(ptr, maxBytesToRead) {
  return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : '';
}

// Copies the given Javascript String object 'str' to the given byte array at address 'outIdx',
// encoded in UTF8 form and null-terminated. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outU8Array: the array to copy to. Each index in this array is assumed to be one 8-byte element.
//   outIdx: The starting offset in the array to begin the copying.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array.
//                    This count should include the null terminator,
//                    i.e. if maxBytesToWrite=1, only the null terminator will be written and nothing else.
//                    maxBytesToWrite=0 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
  if (!(maxBytesToWrite > 0)) // Parameter maxBytesToWrite is not optional. Negative values, 0, null, undefined and false each don't write out any bytes.
    return 0;

  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) {
      var u1 = str.charCodeAt(++i);
      u = 0x10000 + ((u & 0x3FF) << 10) | (u1 & 0x3FF);
    }
    if (u <= 0x7F) {
      if (outIdx >= endIdx) break;
      outU8Array[outIdx++] = u;
    } else if (u <= 0x7FF) {
      if (outIdx + 1 >= endIdx) break;
      outU8Array[outIdx++] = 0xC0 | (u >> 6);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0xFFFF) {
      if (outIdx + 2 >= endIdx) break;
      outU8Array[outIdx++] = 0xE0 | (u >> 12);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else {
      if (outIdx + 3 >= endIdx) break;
      if (u >= 0x200000) warnOnce('Invalid Unicode code point 0x' + u.toString(16) + ' encountered when serializing a JS string to an UTF-8 string on the asm.js/wasm heap! (Valid unicode code points should be in range 0-0x1FFFFF).');
      outU8Array[outIdx++] = 0xF0 | (u >> 18);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    }
  }
  // Null-terminate the pointer to the buffer.
  outU8Array[outIdx] = 0;
  return outIdx - startIdx;
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF8 form. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8(str, outPtr, maxBytesToWrite) {
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  return stringToUTF8Array(str, HEAPU8,outPtr, maxBytesToWrite);
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF8 byte array, EXCLUDING the null terminator byte.
function lengthBytesUTF8(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF);
    if (u <= 0x7F) ++len;
    else if (u <= 0x7FF) len += 2;
    else if (u <= 0xFFFF) len += 3;
    else len += 4;
  }
  return len;
}


// Given a pointer 'ptr' to a null-terminated UTF16LE-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

var UTF16Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : undefined;
function UTF16ToString(ptr) {
  assert(ptr % 2 == 0, 'Pointer passed to UTF16ToString must be aligned to two bytes!');
  var endPtr = ptr;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  var idx = endPtr >> 1;
  while (HEAP16[idx]) ++idx;
  endPtr = idx << 1;

  if (endPtr - ptr > 32 && UTF16Decoder) {
    return UTF16Decoder.decode(HEAPU8.subarray(ptr, endPtr));
  } else {
    var i = 0;

    var str = '';
    while (1) {
      var codeUnit = HEAP16[(((ptr)+(i*2))>>1)];
      if (codeUnit == 0) return str;
      ++i;
      // fromCharCode constructs a character from a UTF-16 code unit, so we can pass the UTF16 string right through.
      str += String.fromCharCode(codeUnit);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF16 form. The copy will require at most str.length*4+2 bytes of space in the HEAP.
// Use the function lengthBytesUTF16() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=2, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<2 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF16(str, outPtr, maxBytesToWrite) {
  assert(outPtr % 2 == 0, 'Pointer passed to stringToUTF16 must be aligned to two bytes!');
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF16(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 2) return 0;
  maxBytesToWrite -= 2; // Null terminator.
  var startPtr = outPtr;
  var numCharsToWrite = (maxBytesToWrite < str.length*2) ? (maxBytesToWrite / 2) : str.length;
  for (var i = 0; i < numCharsToWrite; ++i) {
    // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    HEAP16[((outPtr)>>1)]=codeUnit;
    outPtr += 2;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP16[((outPtr)>>1)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF16(str) {
  return str.length*2;
}

function UTF32ToString(ptr) {
  assert(ptr % 4 == 0, 'Pointer passed to UTF32ToString must be aligned to four bytes!');
  var i = 0;

  var str = '';
  while (1) {
    var utf32 = HEAP32[(((ptr)+(i*4))>>2)];
    if (utf32 == 0)
      return str;
    ++i;
    // Gotcha: fromCharCode constructs a character from a UTF-16 encoded code (pair), not from a Unicode code point! So encode the code point to UTF-16 for constructing.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    if (utf32 >= 0x10000) {
      var ch = utf32 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    } else {
      str += String.fromCharCode(utf32);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF32 form. The copy will require at most str.length*4+4 bytes of space in the HEAP.
// Use the function lengthBytesUTF32() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=4, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<4 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF32(str, outPtr, maxBytesToWrite) {
  assert(outPtr % 4 == 0, 'Pointer passed to stringToUTF32 must be aligned to four bytes!');
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF32(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 4) return 0;
  var startPtr = outPtr;
  var endPtr = startPtr + maxBytesToWrite - 4;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      var trailSurrogate = str.charCodeAt(++i);
      codeUnit = 0x10000 + ((codeUnit & 0x3FF) << 10) | (trailSurrogate & 0x3FF);
    }
    HEAP32[((outPtr)>>2)]=codeUnit;
    outPtr += 4;
    if (outPtr + 4 > endPtr) break;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP32[((outPtr)>>2)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF32(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) ++i; // possibly a lead surrogate, so skip over the tail surrogate.
    len += 4;
  }

  return len;
}

// Allocate heap space for a JS string, and write it there.
// It is the responsibility of the caller to free() that memory.
function allocateUTF8(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = _malloc(size);
  if (ret) stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Allocate stack space for a JS string, and write it there.
function allocateUTF8OnStack(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = stackAlloc(size);
  stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Deprecated: This function should not be called because it is unsafe and does not provide
// a maximum length limit of how many bytes it is allowed to write. Prefer calling the
// function stringToUTF8Array() instead, which takes in a maximum length that can be used
// to be secure from out of bounds writes.
/** @deprecated */
function writeStringToMemory(string, buffer, dontAddNull) {
  warnOnce('writeStringToMemory is deprecated and should not be called! Use stringToUTF8() instead!');

  var /** @type {number} */ lastChar, /** @type {number} */ end;
  if (dontAddNull) {
    // stringToUTF8Array always appends null. If we don't want to do that, remember the
    // character that existed at the location where the null will be placed, and restore
    // that after the write (below).
    end = buffer + lengthBytesUTF8(string);
    lastChar = HEAP8[end];
  }
  stringToUTF8(string, buffer, Infinity);
  if (dontAddNull) HEAP8[end] = lastChar; // Restore the value under the null character.
}

function writeArrayToMemory(array, buffer) {
  assert(array.length >= 0, 'writeArrayToMemory array must have a length (should be an array or typed array)')
  HEAP8.set(array, buffer);
}

function writeAsciiToMemory(str, buffer, dontAddNull) {
  for (var i = 0; i < str.length; ++i) {
    assert(str.charCodeAt(i) === str.charCodeAt(i)&0xff);
    HEAP8[((buffer++)>>0)]=str.charCodeAt(i);
  }
  // Null-terminate the pointer to the HEAP.
  if (!dontAddNull) HEAP8[((buffer)>>0)]=0;
}





function demangle(func) {
  warnOnce('warning: build with  -s DEMANGLE_SUPPORT=1  to link in libcxxabi demangling');
  return func;
}

function demangleAll(text) {
  var regex =
    /__Z[\w\d_]+/g;
  return text.replace(regex,
    function(x) {
      var y = demangle(x);
      return x === y ? x : (y + ' [' + x + ']');
    });
}

function jsStackTrace() {
  var err = new Error();
  if (!err.stack) {
    // IE10+ special cases: It does have callstack info, but it is only populated if an Error object is thrown,
    // so try that as a special-case.
    try {
      throw new Error(0);
    } catch(e) {
      err = e;
    }
    if (!err.stack) {
      return '(no stack trace available)';
    }
  }
  return err.stack.toString();
}

function stackTrace() {
  var js = jsStackTrace();
  if (Module['extraStackTrace']) js += '\n' + Module['extraStackTrace']();
  return demangleAll(js);
}



// Memory management

var PAGE_SIZE = 16384;
var WASM_PAGE_SIZE = 65536;
var ASMJS_PAGE_SIZE = 16777216;

function alignUp(x, multiple) {
  if (x % multiple > 0) {
    x += multiple - (x % multiple);
  }
  return x;
}

var HEAP,
/** @type {ArrayBuffer} */
  buffer,
/** @type {Int8Array} */
  HEAP8,
/** @type {Uint8Array} */
  HEAPU8,
/** @type {Int16Array} */
  HEAP16,
/** @type {Uint16Array} */
  HEAPU16,
/** @type {Int32Array} */
  HEAP32,
/** @type {Uint32Array} */
  HEAPU32,
/** @type {Float32Array} */
  HEAPF32,
/** @type {Float64Array} */
  HEAPF64;

function updateGlobalBufferViews() {
  Module['HEAP8'] = HEAP8 = new Int8Array(buffer);
  Module['HEAP16'] = HEAP16 = new Int16Array(buffer);
  Module['HEAP32'] = HEAP32 = new Int32Array(buffer);
  Module['HEAPU8'] = HEAPU8 = new Uint8Array(buffer);
  Module['HEAPU16'] = HEAPU16 = new Uint16Array(buffer);
  Module['HEAPU32'] = HEAPU32 = new Uint32Array(buffer);
  Module['HEAPF32'] = HEAPF32 = new Float32Array(buffer);
  Module['HEAPF64'] = HEAPF64 = new Float64Array(buffer);
}


var STATIC_BASE = 1024,
    STACK_BASE = 772560,
    STACKTOP = STACK_BASE,
    STACK_MAX = 6015440,
    DYNAMIC_BASE = 6015440,
    DYNAMICTOP_PTR = 772528;

assert(STACK_BASE % 16 === 0, 'stack must start aligned');
assert(DYNAMIC_BASE % 16 === 0, 'heap must start aligned');



var TOTAL_STACK = 5242880;
if (Module['TOTAL_STACK']) assert(TOTAL_STACK === Module['TOTAL_STACK'], 'the stack size can no longer be determined at runtime')

var INITIAL_TOTAL_MEMORY = Module['TOTAL_MEMORY'] || 16777216;
if (INITIAL_TOTAL_MEMORY < TOTAL_STACK) err('TOTAL_MEMORY should be larger than TOTAL_STACK, was ' + INITIAL_TOTAL_MEMORY + '! (TOTAL_STACK=' + TOTAL_STACK + ')');

// Initialize the runtime's memory
// check for full engine support (use string 'subarray' to avoid closure compiler confusion)
assert(typeof Int32Array !== 'undefined' && typeof Float64Array !== 'undefined' && Int32Array.prototype.subarray !== undefined && Int32Array.prototype.set !== undefined,
       'JS engine does not provide full typed array support');







// Use a provided buffer, if there is one, or else allocate a new one
if (Module['buffer']) {
  buffer = Module['buffer'];
  assert(buffer.byteLength === INITIAL_TOTAL_MEMORY, 'provided buffer should be ' + INITIAL_TOTAL_MEMORY + ' bytes, but it is ' + buffer.byteLength);
} else {
  // Use a WebAssembly memory where available
  if (typeof WebAssembly === 'object' && typeof WebAssembly.Memory === 'function') {
    assert(INITIAL_TOTAL_MEMORY % WASM_PAGE_SIZE === 0);
    wasmMemory = new WebAssembly.Memory({ 'initial': INITIAL_TOTAL_MEMORY / WASM_PAGE_SIZE });
    buffer = wasmMemory.buffer;
  } else
  {
    buffer = new ArrayBuffer(INITIAL_TOTAL_MEMORY);
  }
  assert(buffer.byteLength === INITIAL_TOTAL_MEMORY);
}
updateGlobalBufferViews();


HEAP32[DYNAMICTOP_PTR>>2] = DYNAMIC_BASE;


// Initializes the stack cookie. Called at the startup of main and at the startup of each thread in pthreads mode.
function writeStackCookie() {
  assert((STACK_MAX & 3) == 0);
  HEAPU32[(STACK_MAX >> 2)-1] = 0x02135467;
  HEAPU32[(STACK_MAX >> 2)-2] = 0x89BACDFE;
}

function checkStackCookie() {
  if (HEAPU32[(STACK_MAX >> 2)-1] != 0x02135467 || HEAPU32[(STACK_MAX >> 2)-2] != 0x89BACDFE) {
    abort('Stack overflow! Stack cookie has been overwritten, expected hex dwords 0x89BACDFE and 0x02135467, but received 0x' + HEAPU32[(STACK_MAX >> 2)-2].toString(16) + ' ' + HEAPU32[(STACK_MAX >> 2)-1].toString(16));
  }
  // Also test the global address 0 for integrity.
  if (HEAP32[0] !== 0x63736d65 /* 'emsc' */) throw 'Runtime error: The application has corrupted its heap memory area (address zero)!';
}

function abortStackOverflow(allocSize) {
  abort('Stack overflow! Attempted to allocate ' + allocSize + ' bytes on the stack, but stack has only ' + (STACK_MAX - stackSave() + allocSize) + ' bytes available!');
}


  HEAP32[0] = 0x63736d65; /* 'emsc' */



// Endianness check (note: assumes compiler arch was little-endian)
HEAP16[1] = 0x6373;
if (HEAPU8[2] !== 0x73 || HEAPU8[3] !== 0x63) throw 'Runtime error: expected the system to be little-endian!';

function callRuntimeCallbacks(callbacks) {
  while(callbacks.length > 0) {
    var callback = callbacks.shift();
    if (typeof callback == 'function') {
      callback();
      continue;
    }
    var func = callback.func;
    if (typeof func === 'number') {
      if (callback.arg === undefined) {
        Module['dynCall_v'](func);
      } else {
        Module['dynCall_vi'](func, callback.arg);
      }
    } else {
      func(callback.arg === undefined ? null : callback.arg);
    }
  }
}

var __ATPRERUN__  = []; // functions called before the runtime is initialized
var __ATINIT__    = []; // functions called during startup
var __ATMAIN__    = []; // functions called when main() is to be run
var __ATEXIT__    = []; // functions called during shutdown
var __ATPOSTRUN__ = []; // functions called after the main() is called

var runtimeInitialized = false;
var runtimeExited = false;


function preRun() {
  // compatibility - merge in anything from Module['preRun'] at this time
  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPRERUN__);
}

function ensureInitRuntime() {
  checkStackCookie();
  if (runtimeInitialized) return;
  runtimeInitialized = true;
  if (!Module["noFSInit"] && !FS.init.initialized) FS.init();
TTY.init();
  callRuntimeCallbacks(__ATINIT__);
}

function preMain() {
  checkStackCookie();
  FS.ignorePermissions = false;
  callRuntimeCallbacks(__ATMAIN__);
}

function exitRuntime() {
  checkStackCookie();
  runtimeExited = true;
}

function postRun() {
  checkStackCookie();
  // compatibility - merge in anything from Module['postRun'] at this time
  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPOSTRUN__);
}

function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}

function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}

function addOnPreMain(cb) {
  __ATMAIN__.unshift(cb);
}

function addOnExit(cb) {
}

function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}

function unSign(value, bits, ignore) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2*Math.abs(1 << (bits-1)) + value // Need some trickery, since if bits == 32, we are right at the limit of the bits JS uses in bitshifts
                    : Math.pow(2, bits)         + value;
}
function reSign(value, bits, ignore) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << (bits-1)) // abs is needed if bits == 32
                        : Math.pow(2, bits-1);
  if (value >= half && (bits <= 32 || value > half)) { // for huge values, we can hit the precision limit and always get true here. so don't do that
                                                       // but, in general there is no perfect solution here. With 64-bit ints, we get rounding and errors
                                                       // TODO: In i64 mode 1, resign the two parts separately and safely
    value = -2*half + value; // Cannot bitshift half, as it may be at the limit of the bits JS uses in bitshifts
  }
  return value;
}


assert(Math.imul, 'This browser does not support Math.imul(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.fround, 'This browser does not support Math.fround(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.clz32, 'This browser does not support Math.clz32(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.trunc, 'This browser does not support Math.trunc(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');

var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_round = Math.round;
var Math_min = Math.min;
var Math_max = Math.max;
var Math_clz32 = Math.clz32;
var Math_trunc = Math.trunc;



// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// Module.preRun (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null; // overridden to take different actions when all run dependencies are fulfilled
var runDependencyTracking = {};

function getUniqueRunDependency(id) {
  var orig = id;
  while (1) {
    if (!runDependencyTracking[id]) return id;
    id = orig + Math.random();
  }
  return id;
}

function addRunDependency(id) {
  runDependencies++;
  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }
  if (id) {
    assert(!runDependencyTracking[id]);
    runDependencyTracking[id] = 1;
    if (runDependencyWatcher === null && typeof setInterval !== 'undefined') {
      // Check for missing dependencies every few seconds
      runDependencyWatcher = setInterval(function() {
        if (ABORT) {
          clearInterval(runDependencyWatcher);
          runDependencyWatcher = null;
          return;
        }
        var shown = false;
        for (var dep in runDependencyTracking) {
          if (!shown) {
            shown = true;
            err('still waiting on run dependencies:');
          }
          err('dependency: ' + dep);
        }
        if (shown) {
          err('(end of list)');
        }
      }, 10000);
    }
  } else {
    err('warning: run dependency added without ID');
  }
}

function removeRunDependency(id) {
  runDependencies--;
  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }
  if (id) {
    assert(runDependencyTracking[id]);
    delete runDependencyTracking[id];
  } else {
    err('warning: run dependency removed without ID');
  }
  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback(); // can add another dependenciesFulfilled
    }
  }
}

Module["preloadedImages"] = {}; // maps url to image data
Module["preloadedAudios"] = {}; // maps url to audio data



addOnPreRun(function() {
  function loadDynamicLibraries(libs) {
    if (libs) {
      libs.forEach(function(lib) {
        // libraries linked to main never go away
        loadDynamicLibrary(lib, {global: true, nodelete: true});
      });
    }
  }
  // if we can load dynamic libraries synchronously, do so, otherwise, preload
  if (Module['dynamicLibraries'] && Module['dynamicLibraries'].length > 0 && !Module['readBinary']) {
    // we can't read binary data synchronously, so preload
    addRunDependency('preload_dynamicLibraries');
    Promise.all(Module['dynamicLibraries'].map(function(lib) {
      return loadDynamicLibrary(lib, {loadAsync: true, global: true, nodelete: true});
    })).then(function() {
      // we got them all, wonderful
      removeRunDependency('preload_dynamicLibraries');
    });
    return;
  }
  loadDynamicLibraries(Module['dynamicLibraries']);
});

function lookupSymbol(ptr) { // for a pointer, print out all symbols that resolve to it
  var ret = [];
  for (var i in Module) {
    if (Module[i] === ptr) ret.push(i);
  }
  print(ptr + ' is ' + ret);
}

var memoryInitializer = null;






// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// Prefix of data URIs emitted by SINGLE_FILE and related options.
var dataURIPrefix = 'data:application/octet-stream;base64,';

// Indicates whether filename is a base64 data URI.
function isDataURI(filename) {
  return String.prototype.startsWith ?
      filename.startsWith(dataURIPrefix) :
      filename.indexOf(dataURIPrefix) === 0;
}




var wasmBinaryFile = 'page.wasm';
if (!isDataURI(wasmBinaryFile)) {
  wasmBinaryFile = locateFile(wasmBinaryFile);
}

function getBinary() {
  try {
    if (Module['wasmBinary']) {
      return new Uint8Array(Module['wasmBinary']);
    }
    if (Module['readBinary']) {
      return Module['readBinary'](wasmBinaryFile);
    } else {
      throw "both async and sync fetching of the wasm failed";
    }
  }
  catch (err) {
    abort(err);
  }
}

function getBinaryPromise() {
  // if we don't have the binary yet, and have the Fetch api, use that
  // in some environments, like Electron's render process, Fetch api may be present, but have a different context than expected, let's only use it on the Web
  if (!Module['wasmBinary'] && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && typeof fetch === 'function') {
    return fetch(wasmBinaryFile, { credentials: 'same-origin' }).then(function(response) {
      if (!response['ok']) {
        throw "failed to load wasm binary file at '" + wasmBinaryFile + "'";
      }
      return response['arrayBuffer']();
    }).catch(function () {
      return getBinary();
    });
  }
  // Otherwise, getBinary should be able to get it synchronously
  return new Promise(function(resolve, reject) {
    resolve(getBinary());
  });
}

// Create the wasm instance.
// Receives the wasm imports, returns the exports.
function createWasm(env) {
  // prepare imports
  var info = {
    'env': env
    ,
    'global': {
      'NaN': NaN,
      'Infinity': Infinity
    },
    'global.Math': Math,
    'asm2wasm': asm2wasmImports
  };
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  function receiveInstance(instance, module) {
    var exports = instance.exports;
    Module['asm'] = exports;
    removeRunDependency('wasm-instantiate');
  }
  addRunDependency('wasm-instantiate');

  // User shell pages can write their own Module.instantiateWasm = function(imports, successCallback) callback
  // to manually instantiate the Wasm module themselves. This allows pages to run the instantiation parallel
  // to any other async startup actions they are performing.
  if (Module['instantiateWasm']) {
    try {
      return Module['instantiateWasm'](info, receiveInstance);
    } catch(e) {
      err('Module.instantiateWasm callback failed with error: ' + e);
      return false;
    }
  }

  // Async compilation can be confusing when an error on the page overwrites Module
  // (for example, if the order of elements is wrong, and the one defining Module is
  // later), so we save Module and check it later.
  var trueModule = Module;
  function receiveInstantiatedSource(output) {
    // 'output' is a WebAssemblyInstantiatedSource object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
    assert(Module === trueModule, 'the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?');
    trueModule = null;
      // TODO: Due to Closure regression https://github.com/google/closure-compiler/issues/3193, the above line no longer optimizes out down to the following line.
      // When the regression is fixed, can restore the above USE_PTHREADS-enabled path.
    receiveInstance(output['instance']);
  }
  function instantiateArrayBuffer(receiver) {
    getBinaryPromise().then(function(binary) {
      return WebAssembly.instantiate(binary, info);
    }).then(receiver, function(reason) {
      err('failed to asynchronously prepare wasm: ' + reason);
      abort(reason);
    });
  }
  // Prefer streaming instantiation if available.
  if (!Module['wasmBinary'] &&
      typeof WebAssembly.instantiateStreaming === 'function' &&
      !isDataURI(wasmBinaryFile) &&
      typeof fetch === 'function') {
    WebAssembly.instantiateStreaming(fetch(wasmBinaryFile, { credentials: 'same-origin' }), info)
      .then(receiveInstantiatedSource, function(reason) {
        // We expect the most common failure cause to be a bad MIME type for the binary,
        // in which case falling back to ArrayBuffer instantiation should work.
        err('wasm streaming compile failed: ' + reason);
        err('falling back to ArrayBuffer instantiation');
        instantiateArrayBuffer(receiveInstantiatedSource);
      });
  } else {
    instantiateArrayBuffer(receiveInstantiatedSource);
  }
  return {}; // no exports yet; we'll fill them in later
}

// Provide an "asm.js function" for the application, called to "link" the asm.js module. We instantiate
// the wasm module at that time, and it receives imports and provides exports and so forth, the app
// doesn't need to care that it is wasm or asm.js.

Module['asm'] = function(global, env, providedBuffer) {
  // memory was already allocated (so js could use the buffer)
  env['memory'] = wasmMemory
  ;
  // import table
  env['table'] = wasmTable = new WebAssembly.Table({
    'initial': 1024,
    'element': 'anyfunc'
  });
  // With the wasm backend __memory_base and __table_base and only needed for
  // relocatable output.
  env['__memory_base'] = 1024; // tell the memory segments where to place themselves
  // table starts at 0 by default (even in dynamic linking, for the main module)
  env['__table_base'] = 0;

  var exports = createWasm(env);
  assert(exports, 'binaryen setup failed (no wasm support?)');
  return exports;
};

// === Body ===

var ASM_CONSTS = [];





// STATICTOP = STATIC_BASE + 771536;
/* global initializers */  __ATINIT__.push({ func: function() { globalCtors() } });








/* no memory initializer */
var tempDoublePtr = 772544
assert(tempDoublePtr % 8 == 0);

function copyTempFloat(ptr) { // functions, because inlining this code increases code size too much
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
}

function copyTempDouble(ptr) {
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
  HEAP8[tempDoublePtr+4] = HEAP8[ptr+4];
  HEAP8[tempDoublePtr+5] = HEAP8[ptr+5];
  HEAP8[tempDoublePtr+6] = HEAP8[ptr+6];
  HEAP8[tempDoublePtr+7] = HEAP8[ptr+7];
}

// {{PRE_LIBRARY}}


  function __ZN4llvm11APFloatBase10IEEEdoubleEv(
  ) {
  if (!Module['__ZN4llvm11APFloatBase10IEEEdoubleEv']) abort("external function '_ZN4llvm11APFloatBase10IEEEdoubleEv' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm11APFloatBase10IEEEdoubleEv'].apply(null, arguments);
  }

  function __ZN4llvm11APFloatBase15PPCDoubleDoubleEv(
  ) {
  if (!Module['__ZN4llvm11APFloatBase15PPCDoubleDoubleEv']) abort("external function '_ZN4llvm11APFloatBase15PPCDoubleDoubleEv' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm11APFloatBase15PPCDoubleDoubleEv'].apply(null, arguments);
  }

  function __ZN4llvm11raw_ostream14flush_nonemptyEv(
  ) {
  if (!Module['__ZN4llvm11raw_ostream14flush_nonemptyEv']) abort("external function '_ZN4llvm11raw_ostream14flush_nonemptyEv' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm11raw_ostream14flush_nonemptyEv'].apply(null, arguments);
  }

  function __ZN4llvm11raw_ostream5writeEPKcm(
  ) {
  if (!Module['__ZN4llvm11raw_ostream5writeEPKcm']) abort("external function '_ZN4llvm11raw_ostream5writeEPKcm' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm11raw_ostream5writeEPKcm'].apply(null, arguments);
  }

  function __ZN4llvm11raw_ostream5writeEh(
  ) {
  if (!Module['__ZN4llvm11raw_ostream5writeEh']) abort("external function '_ZN4llvm11raw_ostream5writeEh' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm11raw_ostream5writeEh'].apply(null, arguments);
  }

  function __ZN4llvm11raw_ostreamlsEl(
  ) {
  if (!Module['__ZN4llvm11raw_ostreamlsEl']) abort("external function '_ZN4llvm11raw_ostreamlsEl' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm11raw_ostreamlsEl'].apply(null, arguments);
  }

  function __ZN4llvm18raw_string_ostreamD1Ev(
  ) {
  if (!Module['__ZN4llvm18raw_string_ostreamD1Ev']) abort("external function '_ZN4llvm18raw_string_ostreamD1Ev' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm18raw_string_ostreamD1Ev'].apply(null, arguments);
  }

  function __ZN4llvm3sys14getHostCPUNameEv(
  ) {
  if (!Module['__ZN4llvm3sys14getHostCPUNameEv']) abort("external function '_ZN4llvm3sys14getHostCPUNameEv' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm3sys14getHostCPUNameEv'].apply(null, arguments);
  }

  function __ZN4llvm3sys18getHostCPUFeaturesERNS_9StringMapIbNS_15MallocAllocatorEEE(
  ) {
  if (!Module['__ZN4llvm3sys18getHostCPUFeaturesERNS_9StringMapIbNS_15MallocAllocatorEEE']) abort("external function '_ZN4llvm3sys18getHostCPUFeaturesERNS_9StringMapIbNS_15MallocAllocatorEEE' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm3sys18getHostCPUFeaturesERNS_9StringMapIbNS_15MallocAllocatorEEE'].apply(null, arguments);
  }

  function __ZN4llvm5APInt11ashrInPlaceERKS0_(
  ) {
  if (!Module['__ZN4llvm5APInt11ashrInPlaceERKS0_']) abort("external function '_ZN4llvm5APInt11ashrInPlaceERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm5APInt11ashrInPlaceERKS0_'].apply(null, arguments);
  }

  function __ZN4llvm5APInt11lshrInPlaceERKS0_(
  ) {
  if (!Module['__ZN4llvm5APInt11lshrInPlaceERKS0_']) abort("external function '_ZN4llvm5APInt11lshrInPlaceERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm5APInt11lshrInPlaceERKS0_'].apply(null, arguments);
  }

  function __ZN4llvm5APInt12initSlowCaseERKS0_(
  ) {
  if (!Module['__ZN4llvm5APInt12initSlowCaseERKS0_']) abort("external function '_ZN4llvm5APInt12initSlowCaseERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm5APInt12initSlowCaseERKS0_'].apply(null, arguments);
  }

  function __ZN4llvm5APInt12initSlowCaseEyb(
  ) {
  if (!Module['__ZN4llvm5APInt12initSlowCaseEyb']) abort("external function '_ZN4llvm5APInt12initSlowCaseEyb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm5APInt12initSlowCaseEyb'].apply(null, arguments);
  }

  function __ZN4llvm5APInt16OrAssignSlowCaseERKS0_(
  ) {
  if (!Module['__ZN4llvm5APInt16OrAssignSlowCaseERKS0_']) abort("external function '_ZN4llvm5APInt16OrAssignSlowCaseERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm5APInt16OrAssignSlowCaseERKS0_'].apply(null, arguments);
  }

  function __ZN4llvm5APInt17AndAssignSlowCaseERKS0_(
  ) {
  if (!Module['__ZN4llvm5APInt17AndAssignSlowCaseERKS0_']) abort("external function '_ZN4llvm5APInt17AndAssignSlowCaseERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm5APInt17AndAssignSlowCaseERKS0_'].apply(null, arguments);
  }

  function __ZN4llvm5APInt17XorAssignSlowCaseERKS0_(
  ) {
  if (!Module['__ZN4llvm5APInt17XorAssignSlowCaseERKS0_']) abort("external function '_ZN4llvm5APInt17XorAssignSlowCaseERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm5APInt17XorAssignSlowCaseERKS0_'].apply(null, arguments);
  }

  function __ZN4llvm5APInt19flipAllBitsSlowCaseEv(
  ) {
  if (!Module['__ZN4llvm5APInt19flipAllBitsSlowCaseEv']) abort("external function '_ZN4llvm5APInt19flipAllBitsSlowCaseEv' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm5APInt19flipAllBitsSlowCaseEv'].apply(null, arguments);
  }

  function __ZN4llvm5APIntC1EjNS_8ArrayRefIyEE(
  ) {
  if (!Module['__ZN4llvm5APIntC1EjNS_8ArrayRefIyEE']) abort("external function '_ZN4llvm5APIntC1EjNS_8ArrayRefIyEE' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm5APIntC1EjNS_8ArrayRefIyEE'].apply(null, arguments);
  }

  function __ZN4llvm5APIntlSERKS0_(
  ) {
  if (!Module['__ZN4llvm5APIntlSERKS0_']) abort("external function '_ZN4llvm5APIntlSERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm5APIntlSERKS0_'].apply(null, arguments);
  }

  function __ZN4llvm5APIntmIERKS0_(
  ) {
  if (!Module['__ZN4llvm5APIntmIERKS0_']) abort("external function '_ZN4llvm5APIntmIERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm5APIntmIERKS0_'].apply(null, arguments);
  }

  function __ZN4llvm5APIntmLERKS0_(
  ) {
  if (!Module['__ZN4llvm5APIntmLERKS0_']) abort("external function '_ZN4llvm5APIntmLERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm5APIntmLERKS0_'].apply(null, arguments);
  }

  function __ZN4llvm5APIntpLERKS0_(
  ) {
  if (!Module['__ZN4llvm5APIntpLERKS0_']) abort("external function '_ZN4llvm5APIntpLERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm5APIntpLERKS0_'].apply(null, arguments);
  }

  function __ZN4llvm6detail9IEEEFloatC1Ed(
  ) {
  if (!Module['__ZN4llvm6detail9IEEEFloatC1Ed']) abort("external function '_ZN4llvm6detail9IEEEFloatC1Ed' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm6detail9IEEEFloatC1Ed'].apply(null, arguments);
  }

  function __ZN4llvm6detail9IEEEFloatD1Ev(
  ) {
  if (!Module['__ZN4llvm6detail9IEEEFloatD1Ev']) abort("external function '_ZN4llvm6detail9IEEEFloatD1Ev' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm6detail9IEEEFloatD1Ev'].apply(null, arguments);
  }

  function __ZN4llvm7APFloat7StorageC1ENS_6detail9IEEEFloatERKNS_12fltSemanticsE(
  ) {
  if (!Module['__ZN4llvm7APFloat7StorageC1ENS_6detail9IEEEFloatERKNS_12fltSemanticsE']) abort("external function '_ZN4llvm7APFloat7StorageC1ENS_6detail9IEEEFloatERKNS_12fltSemanticsE' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZN4llvm7APFloat7StorageC1ENS_6detail9IEEEFloatERKNS_12fltSemanticsE'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt13EqualSlowCaseERKS0_(
  ) {
  if (!Module['__ZNK4llvm5APInt13EqualSlowCaseERKS0_']) abort("external function '_ZNK4llvm5APInt13EqualSlowCaseERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt13EqualSlowCaseERKS0_'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt13compareSignedERKS0_(
  ) {
  if (!Module['__ZNK4llvm5APInt13compareSignedERKS0_']) abort("external function '_ZNK4llvm5APInt13compareSignedERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt13compareSignedERKS0_'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt13roundToDoubleEb(
  ) {
  if (!Module['__ZNK4llvm5APInt13roundToDoubleEb']) abort("external function '_ZNK4llvm5APInt13roundToDoubleEb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt13roundToDoubleEb'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt23countPopulationSlowCaseEv(
  ) {
  if (!Module['__ZNK4llvm5APInt23countPopulationSlowCaseEv']) abort("external function '_ZNK4llvm5APInt23countPopulationSlowCaseEv' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt23countPopulationSlowCaseEv'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt25countLeadingZerosSlowCaseEv(
  ) {
  if (!Module['__ZNK4llvm5APInt25countLeadingZerosSlowCaseEv']) abort("external function '_ZNK4llvm5APInt25countLeadingZerosSlowCaseEv' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt25countLeadingZerosSlowCaseEv'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt26countTrailingZerosSlowCaseEv(
  ) {
  if (!Module['__ZNK4llvm5APInt26countTrailingZerosSlowCaseEv']) abort("external function '_ZNK4llvm5APInt26countTrailingZerosSlowCaseEv' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt26countTrailingZerosSlowCaseEv'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt4sremERKS0_(
  ) {
  if (!Module['__ZNK4llvm5APInt4sremERKS0_']) abort("external function '_ZNK4llvm5APInt4sremERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt4sremERKS0_'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt4udivERKS0_(
  ) {
  if (!Module['__ZNK4llvm5APInt4udivERKS0_']) abort("external function '_ZNK4llvm5APInt4udivERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt4udivERKS0_'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt4uremERKS0_(
  ) {
  if (!Module['__ZNK4llvm5APInt4uremERKS0_']) abort("external function '_ZNK4llvm5APInt4uremERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt4uremERKS0_'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt7compareERKS0_(
  ) {
  if (!Module['__ZNK4llvm5APInt7compareERKS0_']) abort("external function '_ZNK4llvm5APInt7compareERKS0_' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt7compareERKS0_'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt7sadd_ovERKS0_Rb(
  ) {
  if (!Module['__ZNK4llvm5APInt7sadd_ovERKS0_Rb']) abort("external function '_ZNK4llvm5APInt7sadd_ovERKS0_Rb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt7sadd_ovERKS0_Rb'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt7sdiv_ovERKS0_Rb(
  ) {
  if (!Module['__ZNK4llvm5APInt7sdiv_ovERKS0_Rb']) abort("external function '_ZNK4llvm5APInt7sdiv_ovERKS0_Rb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt7sdiv_ovERKS0_Rb'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt7smul_ovERKS0_Rb(
  ) {
  if (!Module['__ZNK4llvm5APInt7smul_ovERKS0_Rb']) abort("external function '_ZNK4llvm5APInt7smul_ovERKS0_Rb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt7smul_ovERKS0_Rb'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt7ssub_ovERKS0_Rb(
  ) {
  if (!Module['__ZNK4llvm5APInt7ssub_ovERKS0_Rb']) abort("external function '_ZNK4llvm5APInt7ssub_ovERKS0_Rb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt7ssub_ovERKS0_Rb'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt7uadd_ovERKS0_Rb(
  ) {
  if (!Module['__ZNK4llvm5APInt7uadd_ovERKS0_Rb']) abort("external function '_ZNK4llvm5APInt7uadd_ovERKS0_Rb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt7uadd_ovERKS0_Rb'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt7umul_ovERKS0_Rb(
  ) {
  if (!Module['__ZNK4llvm5APInt7umul_ovERKS0_Rb']) abort("external function '_ZNK4llvm5APInt7umul_ovERKS0_Rb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt7umul_ovERKS0_Rb'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt7usub_ovERKS0_Rb(
  ) {
  if (!Module['__ZNK4llvm5APInt7usub_ovERKS0_Rb']) abort("external function '_ZNK4llvm5APInt7usub_ovERKS0_Rb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt7usub_ovERKS0_Rb'].apply(null, arguments);
  }

  function __ZNK4llvm5APInt8byteSwapEv(
  ) {
  if (!Module['__ZNK4llvm5APInt8byteSwapEv']) abort("external function '_ZNK4llvm5APInt8byteSwapEv' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm5APInt8byteSwapEv'].apply(null, arguments);
  }

  function __ZNK4llvm6detail13DoubleAPFloat16convertToIntegerENS_15MutableArrayRefIyEEjbNS_11APFloatBase12roundingModeEPb(
  ) {
  if (!Module['__ZNK4llvm6detail13DoubleAPFloat16convertToIntegerENS_15MutableArrayRefIyEEjbNS_11APFloatBase12roundingModeEPb']) abort("external function '_ZNK4llvm6detail13DoubleAPFloat16convertToIntegerENS_15MutableArrayRefIyEEjbNS_11APFloatBase12roundingModeEPb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm6detail13DoubleAPFloat16convertToIntegerENS_15MutableArrayRefIyEEjbNS_11APFloatBase12roundingModeEPb'].apply(null, arguments);
  }

  function __ZNK4llvm6detail9IEEEFloat16convertToIntegerENS_15MutableArrayRefIyEEjbNS_11APFloatBase12roundingModeEPb(
  ) {
  if (!Module['__ZNK4llvm6detail9IEEEFloat16convertToIntegerENS_15MutableArrayRefIyEEjbNS_11APFloatBase12roundingModeEPb']) abort("external function '_ZNK4llvm6detail9IEEEFloat16convertToIntegerENS_15MutableArrayRefIyEEjbNS_11APFloatBase12roundingModeEPb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZNK4llvm6detail9IEEEFloat16convertToIntegerENS_15MutableArrayRefIyEEjbNS_11APFloatBase12roundingModeEPb'].apply(null, arguments);
  }

  
  var ENV={};function ___buildEnvironment(environ) {
      // WARNING: Arbitrary limit!
      var MAX_ENV_VALUES = 64;
      var TOTAL_ENV_SIZE = 1024;
  
      // Statically allocate memory for the environment.
      var poolPtr;
      var envPtr;
      if (!___buildEnvironment.called) {
        ___buildEnvironment.called = true;
        // Set default values. Use string keys for Closure Compiler compatibility.
        ENV['USER'] = ENV['LOGNAME'] = 'web_user';
        ENV['PATH'] = '/';
        ENV['PWD'] = '/';
        ENV['HOME'] = '/home/web_user';
        ENV['LANG'] = 'C.UTF-8';
        ENV['_'] = Module['thisProgram'];
        // Allocate memory.
        poolPtr = getMemory(TOTAL_ENV_SIZE);
        envPtr = getMemory(MAX_ENV_VALUES * 4);
        HEAP32[((envPtr)>>2)]=poolPtr;
        HEAP32[((environ)>>2)]=envPtr;
      } else {
        envPtr = HEAP32[((environ)>>2)];
        poolPtr = HEAP32[((envPtr)>>2)];
      }
  
      // Collect key=value lines.
      var strings = [];
      var totalSize = 0;
      for (var key in ENV) {
        if (typeof ENV[key] === 'string') {
          var line = key + '=' + ENV[key];
          strings.push(line);
          totalSize += line.length;
        }
      }
      if (totalSize > TOTAL_ENV_SIZE) {
        throw new Error('Environment size exceeded TOTAL_ENV_SIZE!');
      }
  
      // Make new.
      var ptrSize = 4;
      for (var i = 0; i < strings.length; i++) {
        var line = strings[i];
        writeAsciiToMemory(line, poolPtr);
        HEAP32[(((envPtr)+(i * ptrSize))>>2)]=poolPtr;
        poolPtr += line.length + 1;
      }
      HEAP32[(((envPtr)+(strings.length * ptrSize))>>2)]=0;
    }

  
  
  function _emscripten_get_now() { abort() }
  
  function _emscripten_get_now_is_monotonic() {
      // return whether emscripten_get_now is guaranteed monotonic; the Date.now
      // implementation is not :(
      return (0
        || ENVIRONMENT_IS_NODE
        || (typeof dateNow !== 'undefined')
        || (typeof performance === 'object' && performance && typeof performance['now'] === 'function')
        );
    }
  
  function ___setErrNo(value) {
      if (Module['___errno_location']) HEAP32[((Module['___errno_location']())>>2)]=value;
      else err('failed to set errno from JS');
      return value;
    }function _clock_gettime(clk_id, tp) {
      // int clock_gettime(clockid_t clk_id, struct timespec *tp);
      var now;
      if (clk_id === 0) {
        now = Date.now();
      } else if (clk_id === 1 && _emscripten_get_now_is_monotonic()) {
        now = _emscripten_get_now();
      } else {
        ___setErrNo(22);
        return -1;
      }
      HEAP32[((tp)>>2)]=(now/1000)|0; // seconds
      HEAP32[(((tp)+(4))>>2)]=((now % 1000)*1000*1000)|0; // nanoseconds
      return 0;
    }function ___clock_gettime(a0,a1
  ) {
  return _clock_gettime(a0,a1);
  }

  
  
   
  
   
  
  function _llvm_cttz_i32(x) { // Note: Currently doesn't take isZeroUndef()
      x = x | 0;
      return (x ? (31 - (Math_clz32((x ^ (x - 1))) | 0) | 0) : 32) | 0;
    }  

  function ___gmp_asprintf(
  ) {
  if (!Module['___gmp_asprintf']) abort("external function '__gmp_asprintf' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_asprintf'].apply(null, arguments);
  }

  function ___gmp_get_memory_functions(
  ) {
  if (!Module['___gmp_get_memory_functions']) abort("external function '__gmp_get_memory_functions' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_get_memory_functions'].apply(null, arguments);
  }

  function ___gmp_printf(
  ) {
  if (!Module['___gmp_printf']) abort("external function '__gmp_printf' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_printf'].apply(null, arguments);
  }

  function ___gmp_randclear(
  ) {
  if (!Module['___gmp_randclear']) abort("external function '__gmp_randclear' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_randclear'].apply(null, arguments);
  }

  function ___gmp_randinit(
  ) {
  if (!Module['___gmp_randinit']) abort("external function '__gmp_randinit' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_randinit'].apply(null, arguments);
  }

  function ___gmp_randinit_default(
  ) {
  if (!Module['___gmp_randinit_default']) abort("external function '__gmp_randinit_default' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_randinit_default'].apply(null, arguments);
  }

  function ___gmp_randinit_lc_2exp(
  ) {
  if (!Module['___gmp_randinit_lc_2exp']) abort("external function '__gmp_randinit_lc_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_randinit_lc_2exp'].apply(null, arguments);
  }

  function ___gmp_randinit_lc_2exp_size(
  ) {
  if (!Module['___gmp_randinit_lc_2exp_size']) abort("external function '__gmp_randinit_lc_2exp_size' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_randinit_lc_2exp_size'].apply(null, arguments);
  }

  function ___gmp_randinit_mt(
  ) {
  if (!Module['___gmp_randinit_mt']) abort("external function '__gmp_randinit_mt' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_randinit_mt'].apply(null, arguments);
  }

  function ___gmp_randinit_set(
  ) {
  if (!Module['___gmp_randinit_set']) abort("external function '__gmp_randinit_set' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_randinit_set'].apply(null, arguments);
  }

  function ___gmp_randseed(
  ) {
  if (!Module['___gmp_randseed']) abort("external function '__gmp_randseed' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_randseed'].apply(null, arguments);
  }

  function ___gmp_randseed_ui(
  ) {
  if (!Module['___gmp_randseed_ui']) abort("external function '__gmp_randseed_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_randseed_ui'].apply(null, arguments);
  }

  function ___gmp_scanf(
  ) {
  if (!Module['___gmp_scanf']) abort("external function '__gmp_scanf' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_scanf'].apply(null, arguments);
  }

  function ___gmp_set_memory_functions(
  ) {
  if (!Module['___gmp_set_memory_functions']) abort("external function '__gmp_set_memory_functions' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_set_memory_functions'].apply(null, arguments);
  }

  function ___gmp_snprintf(
  ) {
  if (!Module['___gmp_snprintf']) abort("external function '__gmp_snprintf' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_snprintf'].apply(null, arguments);
  }

  function ___gmp_sprintf(
  ) {
  if (!Module['___gmp_sprintf']) abort("external function '__gmp_sprintf' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_sprintf'].apply(null, arguments);
  }

  function ___gmp_sscanf(
  ) {
  if (!Module['___gmp_sscanf']) abort("external function '__gmp_sscanf' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_sscanf'].apply(null, arguments);
  }

  function ___gmp_urandomb_ui(
  ) {
  if (!Module['___gmp_urandomb_ui']) abort("external function '__gmp_urandomb_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_urandomb_ui'].apply(null, arguments);
  }

  function ___gmp_urandomm_ui(
  ) {
  if (!Module['___gmp_urandomm_ui']) abort("external function '__gmp_urandomm_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_urandomm_ui'].apply(null, arguments);
  }

  function ___gmpf_abs(
  ) {
  if (!Module['___gmpf_abs']) abort("external function '__gmpf_abs' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_abs'].apply(null, arguments);
  }

  function ___gmpf_add(
  ) {
  if (!Module['___gmpf_add']) abort("external function '__gmpf_add' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_add'].apply(null, arguments);
  }

  function ___gmpf_add_ui(
  ) {
  if (!Module['___gmpf_add_ui']) abort("external function '__gmpf_add_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_add_ui'].apply(null, arguments);
  }

  function ___gmpf_ceil(
  ) {
  if (!Module['___gmpf_ceil']) abort("external function '__gmpf_ceil' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_ceil'].apply(null, arguments);
  }

  function ___gmpf_clear(
  ) {
  if (!Module['___gmpf_clear']) abort("external function '__gmpf_clear' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_clear'].apply(null, arguments);
  }

  function ___gmpf_clears(
  ) {
  if (!Module['___gmpf_clears']) abort("external function '__gmpf_clears' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_clears'].apply(null, arguments);
  }

  function ___gmpf_cmp(
  ) {
  if (!Module['___gmpf_cmp']) abort("external function '__gmpf_cmp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_cmp'].apply(null, arguments);
  }

  function ___gmpf_cmp_d(
  ) {
  if (!Module['___gmpf_cmp_d']) abort("external function '__gmpf_cmp_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_cmp_d'].apply(null, arguments);
  }

  function ___gmpf_cmp_si(
  ) {
  if (!Module['___gmpf_cmp_si']) abort("external function '__gmpf_cmp_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_cmp_si'].apply(null, arguments);
  }

  function ___gmpf_cmp_ui(
  ) {
  if (!Module['___gmpf_cmp_ui']) abort("external function '__gmpf_cmp_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_cmp_ui'].apply(null, arguments);
  }

  function ___gmpf_cmp_z(
  ) {
  if (!Module['___gmpf_cmp_z']) abort("external function '__gmpf_cmp_z' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_cmp_z'].apply(null, arguments);
  }

  function ___gmpf_div(
  ) {
  if (!Module['___gmpf_div']) abort("external function '__gmpf_div' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_div'].apply(null, arguments);
  }

  function ___gmpf_div_2exp(
  ) {
  if (!Module['___gmpf_div_2exp']) abort("external function '__gmpf_div_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_div_2exp'].apply(null, arguments);
  }

  function ___gmpf_div_ui(
  ) {
  if (!Module['___gmpf_div_ui']) abort("external function '__gmpf_div_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_div_ui'].apply(null, arguments);
  }

  function ___gmpf_dump(
  ) {
  if (!Module['___gmpf_dump']) abort("external function '__gmpf_dump' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_dump'].apply(null, arguments);
  }

  function ___gmpf_eq(
  ) {
  if (!Module['___gmpf_eq']) abort("external function '__gmpf_eq' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_eq'].apply(null, arguments);
  }

  function ___gmpf_fits_sint_p(
  ) {
  if (!Module['___gmpf_fits_sint_p']) abort("external function '__gmpf_fits_sint_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_fits_sint_p'].apply(null, arguments);
  }

  function ___gmpf_fits_slong_p(
  ) {
  if (!Module['___gmpf_fits_slong_p']) abort("external function '__gmpf_fits_slong_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_fits_slong_p'].apply(null, arguments);
  }

  function ___gmpf_fits_sshort_p(
  ) {
  if (!Module['___gmpf_fits_sshort_p']) abort("external function '__gmpf_fits_sshort_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_fits_sshort_p'].apply(null, arguments);
  }

  function ___gmpf_fits_uint_p(
  ) {
  if (!Module['___gmpf_fits_uint_p']) abort("external function '__gmpf_fits_uint_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_fits_uint_p'].apply(null, arguments);
  }

  function ___gmpf_fits_ulong_p(
  ) {
  if (!Module['___gmpf_fits_ulong_p']) abort("external function '__gmpf_fits_ulong_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_fits_ulong_p'].apply(null, arguments);
  }

  function ___gmpf_fits_ushort_p(
  ) {
  if (!Module['___gmpf_fits_ushort_p']) abort("external function '__gmpf_fits_ushort_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_fits_ushort_p'].apply(null, arguments);
  }

  function ___gmpf_floor(
  ) {
  if (!Module['___gmpf_floor']) abort("external function '__gmpf_floor' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_floor'].apply(null, arguments);
  }

  function ___gmpf_get_d(
  ) {
  if (!Module['___gmpf_get_d']) abort("external function '__gmpf_get_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_get_d'].apply(null, arguments);
  }

  function ___gmpf_get_d_2exp(
  ) {
  if (!Module['___gmpf_get_d_2exp']) abort("external function '__gmpf_get_d_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_get_d_2exp'].apply(null, arguments);
  }

  function ___gmpf_get_default_prec(
  ) {
  if (!Module['___gmpf_get_default_prec']) abort("external function '__gmpf_get_default_prec' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_get_default_prec'].apply(null, arguments);
  }

  function ___gmpf_get_prec(
  ) {
  if (!Module['___gmpf_get_prec']) abort("external function '__gmpf_get_prec' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_get_prec'].apply(null, arguments);
  }

  function ___gmpf_get_si(
  ) {
  if (!Module['___gmpf_get_si']) abort("external function '__gmpf_get_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_get_si'].apply(null, arguments);
  }

  function ___gmpf_get_str(
  ) {
  if (!Module['___gmpf_get_str']) abort("external function '__gmpf_get_str' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_get_str'].apply(null, arguments);
  }

  function ___gmpf_get_ui(
  ) {
  if (!Module['___gmpf_get_ui']) abort("external function '__gmpf_get_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_get_ui'].apply(null, arguments);
  }

  function ___gmpf_init(
  ) {
  if (!Module['___gmpf_init']) abort("external function '__gmpf_init' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_init'].apply(null, arguments);
  }

  function ___gmpf_init2(
  ) {
  if (!Module['___gmpf_init2']) abort("external function '__gmpf_init2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_init2'].apply(null, arguments);
  }

  function ___gmpf_init_set(
  ) {
  if (!Module['___gmpf_init_set']) abort("external function '__gmpf_init_set' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_init_set'].apply(null, arguments);
  }

  function ___gmpf_init_set_d(
  ) {
  if (!Module['___gmpf_init_set_d']) abort("external function '__gmpf_init_set_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_init_set_d'].apply(null, arguments);
  }

  function ___gmpf_init_set_si(
  ) {
  if (!Module['___gmpf_init_set_si']) abort("external function '__gmpf_init_set_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_init_set_si'].apply(null, arguments);
  }

  function ___gmpf_init_set_str(
  ) {
  if (!Module['___gmpf_init_set_str']) abort("external function '__gmpf_init_set_str' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_init_set_str'].apply(null, arguments);
  }

  function ___gmpf_init_set_ui(
  ) {
  if (!Module['___gmpf_init_set_ui']) abort("external function '__gmpf_init_set_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_init_set_ui'].apply(null, arguments);
  }

  function ___gmpf_inits(
  ) {
  if (!Module['___gmpf_inits']) abort("external function '__gmpf_inits' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_inits'].apply(null, arguments);
  }

  function ___gmpf_integer_p(
  ) {
  if (!Module['___gmpf_integer_p']) abort("external function '__gmpf_integer_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_integer_p'].apply(null, arguments);
  }

  function ___gmpf_mul(
  ) {
  if (!Module['___gmpf_mul']) abort("external function '__gmpf_mul' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_mul'].apply(null, arguments);
  }

  function ___gmpf_mul_2exp(
  ) {
  if (!Module['___gmpf_mul_2exp']) abort("external function '__gmpf_mul_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_mul_2exp'].apply(null, arguments);
  }

  function ___gmpf_mul_ui(
  ) {
  if (!Module['___gmpf_mul_ui']) abort("external function '__gmpf_mul_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_mul_ui'].apply(null, arguments);
  }

  function ___gmpf_neg(
  ) {
  if (!Module['___gmpf_neg']) abort("external function '__gmpf_neg' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_neg'].apply(null, arguments);
  }

  function ___gmpf_pow_ui(
  ) {
  if (!Module['___gmpf_pow_ui']) abort("external function '__gmpf_pow_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_pow_ui'].apply(null, arguments);
  }

  function ___gmpf_random2(
  ) {
  if (!Module['___gmpf_random2']) abort("external function '__gmpf_random2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_random2'].apply(null, arguments);
  }

  function ___gmpf_reldiff(
  ) {
  if (!Module['___gmpf_reldiff']) abort("external function '__gmpf_reldiff' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_reldiff'].apply(null, arguments);
  }

  function ___gmpf_set(
  ) {
  if (!Module['___gmpf_set']) abort("external function '__gmpf_set' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_set'].apply(null, arguments);
  }

  function ___gmpf_set_d(
  ) {
  if (!Module['___gmpf_set_d']) abort("external function '__gmpf_set_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_set_d'].apply(null, arguments);
  }

  function ___gmpf_set_default_prec(
  ) {
  if (!Module['___gmpf_set_default_prec']) abort("external function '__gmpf_set_default_prec' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_set_default_prec'].apply(null, arguments);
  }

  function ___gmpf_set_prec(
  ) {
  if (!Module['___gmpf_set_prec']) abort("external function '__gmpf_set_prec' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_set_prec'].apply(null, arguments);
  }

  function ___gmpf_set_prec_raw(
  ) {
  if (!Module['___gmpf_set_prec_raw']) abort("external function '__gmpf_set_prec_raw' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_set_prec_raw'].apply(null, arguments);
  }

  function ___gmpf_set_q(
  ) {
  if (!Module['___gmpf_set_q']) abort("external function '__gmpf_set_q' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_set_q'].apply(null, arguments);
  }

  function ___gmpf_set_si(
  ) {
  if (!Module['___gmpf_set_si']) abort("external function '__gmpf_set_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_set_si'].apply(null, arguments);
  }

  function ___gmpf_set_str(
  ) {
  if (!Module['___gmpf_set_str']) abort("external function '__gmpf_set_str' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_set_str'].apply(null, arguments);
  }

  function ___gmpf_set_ui(
  ) {
  if (!Module['___gmpf_set_ui']) abort("external function '__gmpf_set_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_set_ui'].apply(null, arguments);
  }

  function ___gmpf_set_z(
  ) {
  if (!Module['___gmpf_set_z']) abort("external function '__gmpf_set_z' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_set_z'].apply(null, arguments);
  }

  function ___gmpf_size(
  ) {
  if (!Module['___gmpf_size']) abort("external function '__gmpf_size' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_size'].apply(null, arguments);
  }

  function ___gmpf_sqrt(
  ) {
  if (!Module['___gmpf_sqrt']) abort("external function '__gmpf_sqrt' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_sqrt'].apply(null, arguments);
  }

  function ___gmpf_sqrt_ui(
  ) {
  if (!Module['___gmpf_sqrt_ui']) abort("external function '__gmpf_sqrt_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_sqrt_ui'].apply(null, arguments);
  }

  function ___gmpf_sub(
  ) {
  if (!Module['___gmpf_sub']) abort("external function '__gmpf_sub' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_sub'].apply(null, arguments);
  }

  function ___gmpf_sub_ui(
  ) {
  if (!Module['___gmpf_sub_ui']) abort("external function '__gmpf_sub_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_sub_ui'].apply(null, arguments);
  }

  function ___gmpf_swap(
  ) {
  if (!Module['___gmpf_swap']) abort("external function '__gmpf_swap' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_swap'].apply(null, arguments);
  }

  function ___gmpf_trunc(
  ) {
  if (!Module['___gmpf_trunc']) abort("external function '__gmpf_trunc' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_trunc'].apply(null, arguments);
  }

  function ___gmpf_ui_div(
  ) {
  if (!Module['___gmpf_ui_div']) abort("external function '__gmpf_ui_div' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_ui_div'].apply(null, arguments);
  }

  function ___gmpf_ui_sub(
  ) {
  if (!Module['___gmpf_ui_sub']) abort("external function '__gmpf_ui_sub' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_ui_sub'].apply(null, arguments);
  }

  function ___gmpf_urandomb(
  ) {
  if (!Module['___gmpf_urandomb']) abort("external function '__gmpf_urandomb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpf_urandomb'].apply(null, arguments);
  }

  function ___gmpn_add(
  ) {
  if (!Module['___gmpn_add']) abort("external function '__gmpn_add' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_add'].apply(null, arguments);
  }

  function ___gmpn_add_1(
  ) {
  if (!Module['___gmpn_add_1']) abort("external function '__gmpn_add_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_add_1'].apply(null, arguments);
  }

  function ___gmpn_add_n(
  ) {
  if (!Module['___gmpn_add_n']) abort("external function '__gmpn_add_n' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_add_n'].apply(null, arguments);
  }

  function ___gmpn_addmul_1(
  ) {
  if (!Module['___gmpn_addmul_1']) abort("external function '__gmpn_addmul_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_addmul_1'].apply(null, arguments);
  }

  function ___gmpn_and_n(
  ) {
  if (!Module['___gmpn_and_n']) abort("external function '__gmpn_and_n' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_and_n'].apply(null, arguments);
  }

  function ___gmpn_andn_n(
  ) {
  if (!Module['___gmpn_andn_n']) abort("external function '__gmpn_andn_n' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_andn_n'].apply(null, arguments);
  }

  function ___gmpn_cmp(
  ) {
  if (!Module['___gmpn_cmp']) abort("external function '__gmpn_cmp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_cmp'].apply(null, arguments);
  }

  function ___gmpn_cnd_add_n(
  ) {
  if (!Module['___gmpn_cnd_add_n']) abort("external function '__gmpn_cnd_add_n' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_cnd_add_n'].apply(null, arguments);
  }

  function ___gmpn_cnd_sub_n(
  ) {
  if (!Module['___gmpn_cnd_sub_n']) abort("external function '__gmpn_cnd_sub_n' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_cnd_sub_n'].apply(null, arguments);
  }

  function ___gmpn_cnd_swap(
  ) {
  if (!Module['___gmpn_cnd_swap']) abort("external function '__gmpn_cnd_swap' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_cnd_swap'].apply(null, arguments);
  }

  function ___gmpn_com(
  ) {
  if (!Module['___gmpn_com']) abort("external function '__gmpn_com' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_com'].apply(null, arguments);
  }

  function ___gmpn_copyd(
  ) {
  if (!Module['___gmpn_copyd']) abort("external function '__gmpn_copyd' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_copyd'].apply(null, arguments);
  }

  function ___gmpn_copyi(
  ) {
  if (!Module['___gmpn_copyi']) abort("external function '__gmpn_copyi' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_copyi'].apply(null, arguments);
  }

  function ___gmpn_div_qr_1(
  ) {
  if (!Module['___gmpn_div_qr_1']) abort("external function '__gmpn_div_qr_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_div_qr_1'].apply(null, arguments);
  }

  function ___gmpn_div_qr_2(
  ) {
  if (!Module['___gmpn_div_qr_2']) abort("external function '__gmpn_div_qr_2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_div_qr_2'].apply(null, arguments);
  }

  function ___gmpn_divexact_1(
  ) {
  if (!Module['___gmpn_divexact_1']) abort("external function '__gmpn_divexact_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_divexact_1'].apply(null, arguments);
  }

  function ___gmpn_divexact_by3c(
  ) {
  if (!Module['___gmpn_divexact_by3c']) abort("external function '__gmpn_divexact_by3c' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_divexact_by3c'].apply(null, arguments);
  }

  function ___gmpn_divrem(
  ) {
  if (!Module['___gmpn_divrem']) abort("external function '__gmpn_divrem' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_divrem'].apply(null, arguments);
  }

  function ___gmpn_divrem_1(
  ) {
  if (!Module['___gmpn_divrem_1']) abort("external function '__gmpn_divrem_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_divrem_1'].apply(null, arguments);
  }

  function ___gmpn_divrem_2(
  ) {
  if (!Module['___gmpn_divrem_2']) abort("external function '__gmpn_divrem_2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_divrem_2'].apply(null, arguments);
  }

  function ___gmpn_gcd(
  ) {
  if (!Module['___gmpn_gcd']) abort("external function '__gmpn_gcd' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_gcd'].apply(null, arguments);
  }

  function ___gmpn_gcd_1(
  ) {
  if (!Module['___gmpn_gcd_1']) abort("external function '__gmpn_gcd_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_gcd_1'].apply(null, arguments);
  }

  function ___gmpn_gcdext(
  ) {
  if (!Module['___gmpn_gcdext']) abort("external function '__gmpn_gcdext' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_gcdext'].apply(null, arguments);
  }

  function ___gmpn_gcdext_1(
  ) {
  if (!Module['___gmpn_gcdext_1']) abort("external function '__gmpn_gcdext_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_gcdext_1'].apply(null, arguments);
  }

  function ___gmpn_get_str(
  ) {
  if (!Module['___gmpn_get_str']) abort("external function '__gmpn_get_str' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_get_str'].apply(null, arguments);
  }

  function ___gmpn_hamdist(
  ) {
  if (!Module['___gmpn_hamdist']) abort("external function '__gmpn_hamdist' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_hamdist'].apply(null, arguments);
  }

  function ___gmpn_ior_n(
  ) {
  if (!Module['___gmpn_ior_n']) abort("external function '__gmpn_ior_n' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_ior_n'].apply(null, arguments);
  }

  function ___gmpn_iorn_n(
  ) {
  if (!Module['___gmpn_iorn_n']) abort("external function '__gmpn_iorn_n' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_iorn_n'].apply(null, arguments);
  }

  function ___gmpn_lshift(
  ) {
  if (!Module['___gmpn_lshift']) abort("external function '__gmpn_lshift' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_lshift'].apply(null, arguments);
  }

  function ___gmpn_mod_1(
  ) {
  if (!Module['___gmpn_mod_1']) abort("external function '__gmpn_mod_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_mod_1'].apply(null, arguments);
  }

  function ___gmpn_mul(
  ) {
  if (!Module['___gmpn_mul']) abort("external function '__gmpn_mul' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_mul'].apply(null, arguments);
  }

  function ___gmpn_mul_1(
  ) {
  if (!Module['___gmpn_mul_1']) abort("external function '__gmpn_mul_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_mul_1'].apply(null, arguments);
  }

  function ___gmpn_mul_n(
  ) {
  if (!Module['___gmpn_mul_n']) abort("external function '__gmpn_mul_n' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_mul_n'].apply(null, arguments);
  }

  function ___gmpn_nand_n(
  ) {
  if (!Module['___gmpn_nand_n']) abort("external function '__gmpn_nand_n' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_nand_n'].apply(null, arguments);
  }

  function ___gmpn_neg(
  ) {
  if (!Module['___gmpn_neg']) abort("external function '__gmpn_neg' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_neg'].apply(null, arguments);
  }

  function ___gmpn_nior_n(
  ) {
  if (!Module['___gmpn_nior_n']) abort("external function '__gmpn_nior_n' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_nior_n'].apply(null, arguments);
  }

  function ___gmpn_perfect_power_p(
  ) {
  if (!Module['___gmpn_perfect_power_p']) abort("external function '__gmpn_perfect_power_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_perfect_power_p'].apply(null, arguments);
  }

  function ___gmpn_perfect_square_p(
  ) {
  if (!Module['___gmpn_perfect_square_p']) abort("external function '__gmpn_perfect_square_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_perfect_square_p'].apply(null, arguments);
  }

  function ___gmpn_popcount(
  ) {
  if (!Module['___gmpn_popcount']) abort("external function '__gmpn_popcount' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_popcount'].apply(null, arguments);
  }

  function ___gmpn_pow_1(
  ) {
  if (!Module['___gmpn_pow_1']) abort("external function '__gmpn_pow_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_pow_1'].apply(null, arguments);
  }

  function ___gmpn_preinv_mod_1(
  ) {
  if (!Module['___gmpn_preinv_mod_1']) abort("external function '__gmpn_preinv_mod_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_preinv_mod_1'].apply(null, arguments);
  }

  function ___gmpn_random(
  ) {
  if (!Module['___gmpn_random']) abort("external function '__gmpn_random' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_random'].apply(null, arguments);
  }

  function ___gmpn_random2(
  ) {
  if (!Module['___gmpn_random2']) abort("external function '__gmpn_random2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_random2'].apply(null, arguments);
  }

  function ___gmpn_rshift(
  ) {
  if (!Module['___gmpn_rshift']) abort("external function '__gmpn_rshift' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_rshift'].apply(null, arguments);
  }

  function ___gmpn_scan0(
  ) {
  if (!Module['___gmpn_scan0']) abort("external function '__gmpn_scan0' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_scan0'].apply(null, arguments);
  }

  function ___gmpn_scan1(
  ) {
  if (!Module['___gmpn_scan1']) abort("external function '__gmpn_scan1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_scan1'].apply(null, arguments);
  }

  function ___gmpn_sec_add_1(
  ) {
  if (!Module['___gmpn_sec_add_1']) abort("external function '__gmpn_sec_add_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_add_1'].apply(null, arguments);
  }

  function ___gmpn_sec_add_1_itch(
  ) {
  if (!Module['___gmpn_sec_add_1_itch']) abort("external function '__gmpn_sec_add_1_itch' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_add_1_itch'].apply(null, arguments);
  }

  function ___gmpn_sec_div_qr(
  ) {
  if (!Module['___gmpn_sec_div_qr']) abort("external function '__gmpn_sec_div_qr' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_div_qr'].apply(null, arguments);
  }

  function ___gmpn_sec_div_qr_itch(
  ) {
  if (!Module['___gmpn_sec_div_qr_itch']) abort("external function '__gmpn_sec_div_qr_itch' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_div_qr_itch'].apply(null, arguments);
  }

  function ___gmpn_sec_div_r(
  ) {
  if (!Module['___gmpn_sec_div_r']) abort("external function '__gmpn_sec_div_r' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_div_r'].apply(null, arguments);
  }

  function ___gmpn_sec_div_r_itch(
  ) {
  if (!Module['___gmpn_sec_div_r_itch']) abort("external function '__gmpn_sec_div_r_itch' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_div_r_itch'].apply(null, arguments);
  }

  function ___gmpn_sec_invert(
  ) {
  if (!Module['___gmpn_sec_invert']) abort("external function '__gmpn_sec_invert' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_invert'].apply(null, arguments);
  }

  function ___gmpn_sec_invert_itch(
  ) {
  if (!Module['___gmpn_sec_invert_itch']) abort("external function '__gmpn_sec_invert_itch' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_invert_itch'].apply(null, arguments);
  }

  function ___gmpn_sec_mul(
  ) {
  if (!Module['___gmpn_sec_mul']) abort("external function '__gmpn_sec_mul' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_mul'].apply(null, arguments);
  }

  function ___gmpn_sec_mul_itch(
  ) {
  if (!Module['___gmpn_sec_mul_itch']) abort("external function '__gmpn_sec_mul_itch' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_mul_itch'].apply(null, arguments);
  }

  function ___gmpn_sec_powm(
  ) {
  if (!Module['___gmpn_sec_powm']) abort("external function '__gmpn_sec_powm' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_powm'].apply(null, arguments);
  }

  function ___gmpn_sec_powm_itch(
  ) {
  if (!Module['___gmpn_sec_powm_itch']) abort("external function '__gmpn_sec_powm_itch' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_powm_itch'].apply(null, arguments);
  }

  function ___gmpn_sec_sqr(
  ) {
  if (!Module['___gmpn_sec_sqr']) abort("external function '__gmpn_sec_sqr' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_sqr'].apply(null, arguments);
  }

  function ___gmpn_sec_sqr_itch(
  ) {
  if (!Module['___gmpn_sec_sqr_itch']) abort("external function '__gmpn_sec_sqr_itch' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_sqr_itch'].apply(null, arguments);
  }

  function ___gmpn_sec_sub_1(
  ) {
  if (!Module['___gmpn_sec_sub_1']) abort("external function '__gmpn_sec_sub_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_sub_1'].apply(null, arguments);
  }

  function ___gmpn_sec_sub_1_itch(
  ) {
  if (!Module['___gmpn_sec_sub_1_itch']) abort("external function '__gmpn_sec_sub_1_itch' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_sub_1_itch'].apply(null, arguments);
  }

  function ___gmpn_sec_tabselect(
  ) {
  if (!Module['___gmpn_sec_tabselect']) abort("external function '__gmpn_sec_tabselect' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sec_tabselect'].apply(null, arguments);
  }

  function ___gmpn_set_str(
  ) {
  if (!Module['___gmpn_set_str']) abort("external function '__gmpn_set_str' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_set_str'].apply(null, arguments);
  }

  function ___gmpn_sizeinbase(
  ) {
  if (!Module['___gmpn_sizeinbase']) abort("external function '__gmpn_sizeinbase' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sizeinbase'].apply(null, arguments);
  }

  function ___gmpn_sqr(
  ) {
  if (!Module['___gmpn_sqr']) abort("external function '__gmpn_sqr' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sqr'].apply(null, arguments);
  }

  function ___gmpn_sqrtrem(
  ) {
  if (!Module['___gmpn_sqrtrem']) abort("external function '__gmpn_sqrtrem' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sqrtrem'].apply(null, arguments);
  }

  function ___gmpn_sub(
  ) {
  if (!Module['___gmpn_sub']) abort("external function '__gmpn_sub' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sub'].apply(null, arguments);
  }

  function ___gmpn_sub_1(
  ) {
  if (!Module['___gmpn_sub_1']) abort("external function '__gmpn_sub_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sub_1'].apply(null, arguments);
  }

  function ___gmpn_sub_n(
  ) {
  if (!Module['___gmpn_sub_n']) abort("external function '__gmpn_sub_n' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_sub_n'].apply(null, arguments);
  }

  function ___gmpn_submul_1(
  ) {
  if (!Module['___gmpn_submul_1']) abort("external function '__gmpn_submul_1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_submul_1'].apply(null, arguments);
  }

  function ___gmpn_tdiv_qr(
  ) {
  if (!Module['___gmpn_tdiv_qr']) abort("external function '__gmpn_tdiv_qr' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_tdiv_qr'].apply(null, arguments);
  }

  function ___gmpn_xnor_n(
  ) {
  if (!Module['___gmpn_xnor_n']) abort("external function '__gmpn_xnor_n' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_xnor_n'].apply(null, arguments);
  }

  function ___gmpn_xor_n(
  ) {
  if (!Module['___gmpn_xor_n']) abort("external function '__gmpn_xor_n' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_xor_n'].apply(null, arguments);
  }

  function ___gmpn_zero(
  ) {
  if (!Module['___gmpn_zero']) abort("external function '__gmpn_zero' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_zero'].apply(null, arguments);
  }

  function ___gmpn_zero_p(
  ) {
  if (!Module['___gmpn_zero_p']) abort("external function '__gmpn_zero_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpn_zero_p'].apply(null, arguments);
  }

  function ___gmpq_abs(
  ) {
  if (!Module['___gmpq_abs']) abort("external function '__gmpq_abs' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_abs'].apply(null, arguments);
  }

  function ___gmpq_add(
  ) {
  if (!Module['___gmpq_add']) abort("external function '__gmpq_add' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_add'].apply(null, arguments);
  }

  function ___gmpq_canonicalize(
  ) {
  if (!Module['___gmpq_canonicalize']) abort("external function '__gmpq_canonicalize' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_canonicalize'].apply(null, arguments);
  }

  function ___gmpq_clear(
  ) {
  if (!Module['___gmpq_clear']) abort("external function '__gmpq_clear' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_clear'].apply(null, arguments);
  }

  function ___gmpq_clears(
  ) {
  if (!Module['___gmpq_clears']) abort("external function '__gmpq_clears' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_clears'].apply(null, arguments);
  }

  function ___gmpq_cmp(
  ) {
  if (!Module['___gmpq_cmp']) abort("external function '__gmpq_cmp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_cmp'].apply(null, arguments);
  }

  function ___gmpq_cmp_si(
  ) {
  if (!Module['___gmpq_cmp_si']) abort("external function '__gmpq_cmp_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_cmp_si'].apply(null, arguments);
  }

  function ___gmpq_cmp_ui(
  ) {
  if (!Module['___gmpq_cmp_ui']) abort("external function '__gmpq_cmp_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_cmp_ui'].apply(null, arguments);
  }

  function ___gmpq_cmp_z(
  ) {
  if (!Module['___gmpq_cmp_z']) abort("external function '__gmpq_cmp_z' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_cmp_z'].apply(null, arguments);
  }

  function ___gmpq_div(
  ) {
  if (!Module['___gmpq_div']) abort("external function '__gmpq_div' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_div'].apply(null, arguments);
  }

  function ___gmpq_div_2exp(
  ) {
  if (!Module['___gmpq_div_2exp']) abort("external function '__gmpq_div_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_div_2exp'].apply(null, arguments);
  }

  function ___gmpq_equal(
  ) {
  if (!Module['___gmpq_equal']) abort("external function '__gmpq_equal' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_equal'].apply(null, arguments);
  }

  function ___gmpq_get_d(
  ) {
  if (!Module['___gmpq_get_d']) abort("external function '__gmpq_get_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_get_d'].apply(null, arguments);
  }

  function ___gmpq_get_den(
  ) {
  if (!Module['___gmpq_get_den']) abort("external function '__gmpq_get_den' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_get_den'].apply(null, arguments);
  }

  function ___gmpq_get_num(
  ) {
  if (!Module['___gmpq_get_num']) abort("external function '__gmpq_get_num' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_get_num'].apply(null, arguments);
  }

  function ___gmpq_get_str(
  ) {
  if (!Module['___gmpq_get_str']) abort("external function '__gmpq_get_str' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_get_str'].apply(null, arguments);
  }

  function ___gmpq_init(
  ) {
  if (!Module['___gmpq_init']) abort("external function '__gmpq_init' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_init'].apply(null, arguments);
  }

  function ___gmpq_inits(
  ) {
  if (!Module['___gmpq_inits']) abort("external function '__gmpq_inits' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_inits'].apply(null, arguments);
  }

  function ___gmpq_inv(
  ) {
  if (!Module['___gmpq_inv']) abort("external function '__gmpq_inv' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_inv'].apply(null, arguments);
  }

  function ___gmpq_mul(
  ) {
  if (!Module['___gmpq_mul']) abort("external function '__gmpq_mul' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_mul'].apply(null, arguments);
  }

  function ___gmpq_mul_2exp(
  ) {
  if (!Module['___gmpq_mul_2exp']) abort("external function '__gmpq_mul_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_mul_2exp'].apply(null, arguments);
  }

  function ___gmpq_neg(
  ) {
  if (!Module['___gmpq_neg']) abort("external function '__gmpq_neg' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_neg'].apply(null, arguments);
  }

  function ___gmpq_set(
  ) {
  if (!Module['___gmpq_set']) abort("external function '__gmpq_set' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_set'].apply(null, arguments);
  }

  function ___gmpq_set_d(
  ) {
  if (!Module['___gmpq_set_d']) abort("external function '__gmpq_set_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_set_d'].apply(null, arguments);
  }

  function ___gmpq_set_den(
  ) {
  if (!Module['___gmpq_set_den']) abort("external function '__gmpq_set_den' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_set_den'].apply(null, arguments);
  }

  function ___gmpq_set_f(
  ) {
  if (!Module['___gmpq_set_f']) abort("external function '__gmpq_set_f' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_set_f'].apply(null, arguments);
  }

  function ___gmpq_set_num(
  ) {
  if (!Module['___gmpq_set_num']) abort("external function '__gmpq_set_num' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_set_num'].apply(null, arguments);
  }

  function ___gmpq_set_si(
  ) {
  if (!Module['___gmpq_set_si']) abort("external function '__gmpq_set_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_set_si'].apply(null, arguments);
  }

  function ___gmpq_set_str(
  ) {
  if (!Module['___gmpq_set_str']) abort("external function '__gmpq_set_str' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_set_str'].apply(null, arguments);
  }

  function ___gmpq_set_ui(
  ) {
  if (!Module['___gmpq_set_ui']) abort("external function '__gmpq_set_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_set_ui'].apply(null, arguments);
  }

  function ___gmpq_set_z(
  ) {
  if (!Module['___gmpq_set_z']) abort("external function '__gmpq_set_z' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_set_z'].apply(null, arguments);
  }

  function ___gmpq_sub(
  ) {
  if (!Module['___gmpq_sub']) abort("external function '__gmpq_sub' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_sub'].apply(null, arguments);
  }

  function ___gmpq_swap(
  ) {
  if (!Module['___gmpq_swap']) abort("external function '__gmpq_swap' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpq_swap'].apply(null, arguments);
  }

  function ___gmpz_2fac_ui(
  ) {
  if (!Module['___gmpz_2fac_ui']) abort("external function '__gmpz_2fac_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_2fac_ui'].apply(null, arguments);
  }

  function ___gmpz_abs(
  ) {
  if (!Module['___gmpz_abs']) abort("external function '__gmpz_abs' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_abs'].apply(null, arguments);
  }

  function ___gmpz_add(
  ) {
  if (!Module['___gmpz_add']) abort("external function '__gmpz_add' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_add'].apply(null, arguments);
  }

  function ___gmpz_add_ui(
  ) {
  if (!Module['___gmpz_add_ui']) abort("external function '__gmpz_add_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_add_ui'].apply(null, arguments);
  }

  function ___gmpz_addmul(
  ) {
  if (!Module['___gmpz_addmul']) abort("external function '__gmpz_addmul' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_addmul'].apply(null, arguments);
  }

  function ___gmpz_addmul_ui(
  ) {
  if (!Module['___gmpz_addmul_ui']) abort("external function '__gmpz_addmul_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_addmul_ui'].apply(null, arguments);
  }

  function ___gmpz_and(
  ) {
  if (!Module['___gmpz_and']) abort("external function '__gmpz_and' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_and'].apply(null, arguments);
  }

  function ___gmpz_array_init(
  ) {
  if (!Module['___gmpz_array_init']) abort("external function '__gmpz_array_init' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_array_init'].apply(null, arguments);
  }

  function ___gmpz_bin_ui(
  ) {
  if (!Module['___gmpz_bin_ui']) abort("external function '__gmpz_bin_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_bin_ui'].apply(null, arguments);
  }

  function ___gmpz_bin_uiui(
  ) {
  if (!Module['___gmpz_bin_uiui']) abort("external function '__gmpz_bin_uiui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_bin_uiui'].apply(null, arguments);
  }

  function ___gmpz_cdiv_q(
  ) {
  if (!Module['___gmpz_cdiv_q']) abort("external function '__gmpz_cdiv_q' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cdiv_q'].apply(null, arguments);
  }

  function ___gmpz_cdiv_q_2exp(
  ) {
  if (!Module['___gmpz_cdiv_q_2exp']) abort("external function '__gmpz_cdiv_q_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cdiv_q_2exp'].apply(null, arguments);
  }

  function ___gmpz_cdiv_q_ui(
  ) {
  if (!Module['___gmpz_cdiv_q_ui']) abort("external function '__gmpz_cdiv_q_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cdiv_q_ui'].apply(null, arguments);
  }

  function ___gmpz_cdiv_qr(
  ) {
  if (!Module['___gmpz_cdiv_qr']) abort("external function '__gmpz_cdiv_qr' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cdiv_qr'].apply(null, arguments);
  }

  function ___gmpz_cdiv_qr_ui(
  ) {
  if (!Module['___gmpz_cdiv_qr_ui']) abort("external function '__gmpz_cdiv_qr_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cdiv_qr_ui'].apply(null, arguments);
  }

  function ___gmpz_cdiv_r(
  ) {
  if (!Module['___gmpz_cdiv_r']) abort("external function '__gmpz_cdiv_r' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cdiv_r'].apply(null, arguments);
  }

  function ___gmpz_cdiv_r_2exp(
  ) {
  if (!Module['___gmpz_cdiv_r_2exp']) abort("external function '__gmpz_cdiv_r_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cdiv_r_2exp'].apply(null, arguments);
  }

  function ___gmpz_cdiv_r_ui(
  ) {
  if (!Module['___gmpz_cdiv_r_ui']) abort("external function '__gmpz_cdiv_r_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cdiv_r_ui'].apply(null, arguments);
  }

  function ___gmpz_cdiv_ui(
  ) {
  if (!Module['___gmpz_cdiv_ui']) abort("external function '__gmpz_cdiv_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cdiv_ui'].apply(null, arguments);
  }

  function ___gmpz_clear(
  ) {
  if (!Module['___gmpz_clear']) abort("external function '__gmpz_clear' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_clear'].apply(null, arguments);
  }

  function ___gmpz_clears(
  ) {
  if (!Module['___gmpz_clears']) abort("external function '__gmpz_clears' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_clears'].apply(null, arguments);
  }

  function ___gmpz_clrbit(
  ) {
  if (!Module['___gmpz_clrbit']) abort("external function '__gmpz_clrbit' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_clrbit'].apply(null, arguments);
  }

  function ___gmpz_cmp(
  ) {
  if (!Module['___gmpz_cmp']) abort("external function '__gmpz_cmp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cmp'].apply(null, arguments);
  }

  function ___gmpz_cmp_d(
  ) {
  if (!Module['___gmpz_cmp_d']) abort("external function '__gmpz_cmp_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cmp_d'].apply(null, arguments);
  }

  function ___gmpz_cmp_si(
  ) {
  if (!Module['___gmpz_cmp_si']) abort("external function '__gmpz_cmp_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cmp_si'].apply(null, arguments);
  }

  function ___gmpz_cmp_ui(
  ) {
  if (!Module['___gmpz_cmp_ui']) abort("external function '__gmpz_cmp_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cmp_ui'].apply(null, arguments);
  }

  function ___gmpz_cmpabs(
  ) {
  if (!Module['___gmpz_cmpabs']) abort("external function '__gmpz_cmpabs' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cmpabs'].apply(null, arguments);
  }

  function ___gmpz_cmpabs_d(
  ) {
  if (!Module['___gmpz_cmpabs_d']) abort("external function '__gmpz_cmpabs_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cmpabs_d'].apply(null, arguments);
  }

  function ___gmpz_cmpabs_ui(
  ) {
  if (!Module['___gmpz_cmpabs_ui']) abort("external function '__gmpz_cmpabs_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_cmpabs_ui'].apply(null, arguments);
  }

  function ___gmpz_com(
  ) {
  if (!Module['___gmpz_com']) abort("external function '__gmpz_com' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_com'].apply(null, arguments);
  }

  function ___gmpz_combit(
  ) {
  if (!Module['___gmpz_combit']) abort("external function '__gmpz_combit' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_combit'].apply(null, arguments);
  }

  function ___gmpz_congruent_2exp_p(
  ) {
  if (!Module['___gmpz_congruent_2exp_p']) abort("external function '__gmpz_congruent_2exp_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_congruent_2exp_p'].apply(null, arguments);
  }

  function ___gmpz_congruent_p(
  ) {
  if (!Module['___gmpz_congruent_p']) abort("external function '__gmpz_congruent_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_congruent_p'].apply(null, arguments);
  }

  function ___gmpz_congruent_ui_p(
  ) {
  if (!Module['___gmpz_congruent_ui_p']) abort("external function '__gmpz_congruent_ui_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_congruent_ui_p'].apply(null, arguments);
  }

  function ___gmpz_divexact(
  ) {
  if (!Module['___gmpz_divexact']) abort("external function '__gmpz_divexact' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_divexact'].apply(null, arguments);
  }

  function ___gmpz_divexact_ui(
  ) {
  if (!Module['___gmpz_divexact_ui']) abort("external function '__gmpz_divexact_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_divexact_ui'].apply(null, arguments);
  }

  function ___gmpz_divisible_2exp_p(
  ) {
  if (!Module['___gmpz_divisible_2exp_p']) abort("external function '__gmpz_divisible_2exp_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_divisible_2exp_p'].apply(null, arguments);
  }

  function ___gmpz_divisible_p(
  ) {
  if (!Module['___gmpz_divisible_p']) abort("external function '__gmpz_divisible_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_divisible_p'].apply(null, arguments);
  }

  function ___gmpz_divisible_ui_p(
  ) {
  if (!Module['___gmpz_divisible_ui_p']) abort("external function '__gmpz_divisible_ui_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_divisible_ui_p'].apply(null, arguments);
  }

  function ___gmpz_dump(
  ) {
  if (!Module['___gmpz_dump']) abort("external function '__gmpz_dump' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_dump'].apply(null, arguments);
  }

  function ___gmpz_export(
  ) {
  if (!Module['___gmpz_export']) abort("external function '__gmpz_export' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_export'].apply(null, arguments);
  }

  function ___gmpz_fac_ui(
  ) {
  if (!Module['___gmpz_fac_ui']) abort("external function '__gmpz_fac_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fac_ui'].apply(null, arguments);
  }

  function ___gmpz_fdiv_q(
  ) {
  if (!Module['___gmpz_fdiv_q']) abort("external function '__gmpz_fdiv_q' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fdiv_q'].apply(null, arguments);
  }

  function ___gmpz_fdiv_q_2exp(
  ) {
  if (!Module['___gmpz_fdiv_q_2exp']) abort("external function '__gmpz_fdiv_q_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fdiv_q_2exp'].apply(null, arguments);
  }

  function ___gmpz_fdiv_q_ui(
  ) {
  if (!Module['___gmpz_fdiv_q_ui']) abort("external function '__gmpz_fdiv_q_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fdiv_q_ui'].apply(null, arguments);
  }

  function ___gmpz_fdiv_qr(
  ) {
  if (!Module['___gmpz_fdiv_qr']) abort("external function '__gmpz_fdiv_qr' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fdiv_qr'].apply(null, arguments);
  }

  function ___gmpz_fdiv_qr_ui(
  ) {
  if (!Module['___gmpz_fdiv_qr_ui']) abort("external function '__gmpz_fdiv_qr_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fdiv_qr_ui'].apply(null, arguments);
  }

  function ___gmpz_fdiv_r(
  ) {
  if (!Module['___gmpz_fdiv_r']) abort("external function '__gmpz_fdiv_r' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fdiv_r'].apply(null, arguments);
  }

  function ___gmpz_fdiv_r_2exp(
  ) {
  if (!Module['___gmpz_fdiv_r_2exp']) abort("external function '__gmpz_fdiv_r_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fdiv_r_2exp'].apply(null, arguments);
  }

  function ___gmpz_fdiv_r_ui(
  ) {
  if (!Module['___gmpz_fdiv_r_ui']) abort("external function '__gmpz_fdiv_r_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fdiv_r_ui'].apply(null, arguments);
  }

  function ___gmpz_fdiv_ui(
  ) {
  if (!Module['___gmpz_fdiv_ui']) abort("external function '__gmpz_fdiv_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fdiv_ui'].apply(null, arguments);
  }

  function ___gmpz_fib2_ui(
  ) {
  if (!Module['___gmpz_fib2_ui']) abort("external function '__gmpz_fib2_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fib2_ui'].apply(null, arguments);
  }

  function ___gmpz_fib_ui(
  ) {
  if (!Module['___gmpz_fib_ui']) abort("external function '__gmpz_fib_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fib_ui'].apply(null, arguments);
  }

  function ___gmpz_fits_sint_p(
  ) {
  if (!Module['___gmpz_fits_sint_p']) abort("external function '__gmpz_fits_sint_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fits_sint_p'].apply(null, arguments);
  }

  function ___gmpz_fits_slong_p(
  ) {
  if (!Module['___gmpz_fits_slong_p']) abort("external function '__gmpz_fits_slong_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fits_slong_p'].apply(null, arguments);
  }

  function ___gmpz_fits_sshort_p(
  ) {
  if (!Module['___gmpz_fits_sshort_p']) abort("external function '__gmpz_fits_sshort_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fits_sshort_p'].apply(null, arguments);
  }

  function ___gmpz_fits_uint_p(
  ) {
  if (!Module['___gmpz_fits_uint_p']) abort("external function '__gmpz_fits_uint_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fits_uint_p'].apply(null, arguments);
  }

  function ___gmpz_fits_ulong_p(
  ) {
  if (!Module['___gmpz_fits_ulong_p']) abort("external function '__gmpz_fits_ulong_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fits_ulong_p'].apply(null, arguments);
  }

  function ___gmpz_fits_ushort_p(
  ) {
  if (!Module['___gmpz_fits_ushort_p']) abort("external function '__gmpz_fits_ushort_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_fits_ushort_p'].apply(null, arguments);
  }

  function ___gmpz_gcd(
  ) {
  if (!Module['___gmpz_gcd']) abort("external function '__gmpz_gcd' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_gcd'].apply(null, arguments);
  }

  function ___gmpz_gcd_ui(
  ) {
  if (!Module['___gmpz_gcd_ui']) abort("external function '__gmpz_gcd_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_gcd_ui'].apply(null, arguments);
  }

  function ___gmpz_gcdext(
  ) {
  if (!Module['___gmpz_gcdext']) abort("external function '__gmpz_gcdext' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_gcdext'].apply(null, arguments);
  }

  function ___gmpz_get_d(
  ) {
  if (!Module['___gmpz_get_d']) abort("external function '__gmpz_get_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_get_d'].apply(null, arguments);
  }

  function ___gmpz_get_d_2exp(
  ) {
  if (!Module['___gmpz_get_d_2exp']) abort("external function '__gmpz_get_d_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_get_d_2exp'].apply(null, arguments);
  }

  function ___gmpz_get_si(
  ) {
  if (!Module['___gmpz_get_si']) abort("external function '__gmpz_get_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_get_si'].apply(null, arguments);
  }

  function ___gmpz_get_str(
  ) {
  if (!Module['___gmpz_get_str']) abort("external function '__gmpz_get_str' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_get_str'].apply(null, arguments);
  }

  function ___gmpz_get_ui(
  ) {
  if (!Module['___gmpz_get_ui']) abort("external function '__gmpz_get_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_get_ui'].apply(null, arguments);
  }

  function ___gmpz_getlimbn(
  ) {
  if (!Module['___gmpz_getlimbn']) abort("external function '__gmpz_getlimbn' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_getlimbn'].apply(null, arguments);
  }

  function ___gmpz_hamdist(
  ) {
  if (!Module['___gmpz_hamdist']) abort("external function '__gmpz_hamdist' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_hamdist'].apply(null, arguments);
  }

  function ___gmpz_import(
  ) {
  if (!Module['___gmpz_import']) abort("external function '__gmpz_import' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_import'].apply(null, arguments);
  }

  function ___gmpz_init(
  ) {
  if (!Module['___gmpz_init']) abort("external function '__gmpz_init' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_init'].apply(null, arguments);
  }

  function ___gmpz_init2(
  ) {
  if (!Module['___gmpz_init2']) abort("external function '__gmpz_init2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_init2'].apply(null, arguments);
  }

  function ___gmpz_init_set(
  ) {
  if (!Module['___gmpz_init_set']) abort("external function '__gmpz_init_set' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_init_set'].apply(null, arguments);
  }

  function ___gmpz_init_set_d(
  ) {
  if (!Module['___gmpz_init_set_d']) abort("external function '__gmpz_init_set_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_init_set_d'].apply(null, arguments);
  }

  function ___gmpz_init_set_si(
  ) {
  if (!Module['___gmpz_init_set_si']) abort("external function '__gmpz_init_set_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_init_set_si'].apply(null, arguments);
  }

  function ___gmpz_init_set_str(
  ) {
  if (!Module['___gmpz_init_set_str']) abort("external function '__gmpz_init_set_str' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_init_set_str'].apply(null, arguments);
  }

  function ___gmpz_init_set_ui(
  ) {
  if (!Module['___gmpz_init_set_ui']) abort("external function '__gmpz_init_set_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_init_set_ui'].apply(null, arguments);
  }

  function ___gmpz_inits(
  ) {
  if (!Module['___gmpz_inits']) abort("external function '__gmpz_inits' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_inits'].apply(null, arguments);
  }

  function ___gmpz_invert(
  ) {
  if (!Module['___gmpz_invert']) abort("external function '__gmpz_invert' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_invert'].apply(null, arguments);
  }

  function ___gmpz_ior(
  ) {
  if (!Module['___gmpz_ior']) abort("external function '__gmpz_ior' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_ior'].apply(null, arguments);
  }

  function ___gmpz_jacobi(
  ) {
  if (!Module['___gmpz_jacobi']) abort("external function '__gmpz_jacobi' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_jacobi'].apply(null, arguments);
  }

  function ___gmpz_kronecker_si(
  ) {
  if (!Module['___gmpz_kronecker_si']) abort("external function '__gmpz_kronecker_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_kronecker_si'].apply(null, arguments);
  }

  function ___gmpz_kronecker_ui(
  ) {
  if (!Module['___gmpz_kronecker_ui']) abort("external function '__gmpz_kronecker_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_kronecker_ui'].apply(null, arguments);
  }

  function ___gmpz_lcm(
  ) {
  if (!Module['___gmpz_lcm']) abort("external function '__gmpz_lcm' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_lcm'].apply(null, arguments);
  }

  function ___gmpz_lcm_ui(
  ) {
  if (!Module['___gmpz_lcm_ui']) abort("external function '__gmpz_lcm_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_lcm_ui'].apply(null, arguments);
  }

  function ___gmpz_limbs_finish(
  ) {
  if (!Module['___gmpz_limbs_finish']) abort("external function '__gmpz_limbs_finish' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_limbs_finish'].apply(null, arguments);
  }

  function ___gmpz_limbs_modify(
  ) {
  if (!Module['___gmpz_limbs_modify']) abort("external function '__gmpz_limbs_modify' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_limbs_modify'].apply(null, arguments);
  }

  function ___gmpz_limbs_read(
  ) {
  if (!Module['___gmpz_limbs_read']) abort("external function '__gmpz_limbs_read' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_limbs_read'].apply(null, arguments);
  }

  function ___gmpz_limbs_write(
  ) {
  if (!Module['___gmpz_limbs_write']) abort("external function '__gmpz_limbs_write' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_limbs_write'].apply(null, arguments);
  }

  function ___gmpz_lucnum2_ui(
  ) {
  if (!Module['___gmpz_lucnum2_ui']) abort("external function '__gmpz_lucnum2_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_lucnum2_ui'].apply(null, arguments);
  }

  function ___gmpz_lucnum_ui(
  ) {
  if (!Module['___gmpz_lucnum_ui']) abort("external function '__gmpz_lucnum_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_lucnum_ui'].apply(null, arguments);
  }

  function ___gmpz_mfac_uiui(
  ) {
  if (!Module['___gmpz_mfac_uiui']) abort("external function '__gmpz_mfac_uiui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_mfac_uiui'].apply(null, arguments);
  }

  function ___gmpz_millerrabin(
  ) {
  if (!Module['___gmpz_millerrabin']) abort("external function '__gmpz_millerrabin' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_millerrabin'].apply(null, arguments);
  }

  function ___gmpz_mod(
  ) {
  if (!Module['___gmpz_mod']) abort("external function '__gmpz_mod' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_mod'].apply(null, arguments);
  }

  function ___gmpz_mul(
  ) {
  if (!Module['___gmpz_mul']) abort("external function '__gmpz_mul' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_mul'].apply(null, arguments);
  }

  function ___gmpz_mul_2exp(
  ) {
  if (!Module['___gmpz_mul_2exp']) abort("external function '__gmpz_mul_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_mul_2exp'].apply(null, arguments);
  }

  function ___gmpz_mul_si(
  ) {
  if (!Module['___gmpz_mul_si']) abort("external function '__gmpz_mul_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_mul_si'].apply(null, arguments);
  }

  function ___gmpz_mul_ui(
  ) {
  if (!Module['___gmpz_mul_ui']) abort("external function '__gmpz_mul_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_mul_ui'].apply(null, arguments);
  }

  function ___gmpz_neg(
  ) {
  if (!Module['___gmpz_neg']) abort("external function '__gmpz_neg' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_neg'].apply(null, arguments);
  }

  function ___gmpz_nextprime(
  ) {
  if (!Module['___gmpz_nextprime']) abort("external function '__gmpz_nextprime' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_nextprime'].apply(null, arguments);
  }

  function ___gmpz_perfect_power_p(
  ) {
  if (!Module['___gmpz_perfect_power_p']) abort("external function '__gmpz_perfect_power_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_perfect_power_p'].apply(null, arguments);
  }

  function ___gmpz_perfect_square_p(
  ) {
  if (!Module['___gmpz_perfect_square_p']) abort("external function '__gmpz_perfect_square_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_perfect_square_p'].apply(null, arguments);
  }

  function ___gmpz_popcount(
  ) {
  if (!Module['___gmpz_popcount']) abort("external function '__gmpz_popcount' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_popcount'].apply(null, arguments);
  }

  function ___gmpz_pow_ui(
  ) {
  if (!Module['___gmpz_pow_ui']) abort("external function '__gmpz_pow_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_pow_ui'].apply(null, arguments);
  }

  function ___gmpz_powm(
  ) {
  if (!Module['___gmpz_powm']) abort("external function '__gmpz_powm' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_powm'].apply(null, arguments);
  }

  function ___gmpz_powm_sec(
  ) {
  if (!Module['___gmpz_powm_sec']) abort("external function '__gmpz_powm_sec' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_powm_sec'].apply(null, arguments);
  }

  function ___gmpz_powm_ui(
  ) {
  if (!Module['___gmpz_powm_ui']) abort("external function '__gmpz_powm_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_powm_ui'].apply(null, arguments);
  }

  function ___gmpz_primorial_ui(
  ) {
  if (!Module['___gmpz_primorial_ui']) abort("external function '__gmpz_primorial_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_primorial_ui'].apply(null, arguments);
  }

  function ___gmpz_probab_prime_p(
  ) {
  if (!Module['___gmpz_probab_prime_p']) abort("external function '__gmpz_probab_prime_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_probab_prime_p'].apply(null, arguments);
  }

  function ___gmpz_random(
  ) {
  if (!Module['___gmpz_random']) abort("external function '__gmpz_random' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_random'].apply(null, arguments);
  }

  function ___gmpz_random2(
  ) {
  if (!Module['___gmpz_random2']) abort("external function '__gmpz_random2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_random2'].apply(null, arguments);
  }

  function ___gmpz_realloc(
  ) {
  if (!Module['___gmpz_realloc']) abort("external function '__gmpz_realloc' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_realloc'].apply(null, arguments);
  }

  function ___gmpz_realloc2(
  ) {
  if (!Module['___gmpz_realloc2']) abort("external function '__gmpz_realloc2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_realloc2'].apply(null, arguments);
  }

  function ___gmpz_remove(
  ) {
  if (!Module['___gmpz_remove']) abort("external function '__gmpz_remove' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_remove'].apply(null, arguments);
  }

  function ___gmpz_roinit_n(
  ) {
  if (!Module['___gmpz_roinit_n']) abort("external function '__gmpz_roinit_n' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_roinit_n'].apply(null, arguments);
  }

  function ___gmpz_root(
  ) {
  if (!Module['___gmpz_root']) abort("external function '__gmpz_root' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_root'].apply(null, arguments);
  }

  function ___gmpz_rootrem(
  ) {
  if (!Module['___gmpz_rootrem']) abort("external function '__gmpz_rootrem' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_rootrem'].apply(null, arguments);
  }

  function ___gmpz_rrandomb(
  ) {
  if (!Module['___gmpz_rrandomb']) abort("external function '__gmpz_rrandomb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_rrandomb'].apply(null, arguments);
  }

  function ___gmpz_scan0(
  ) {
  if (!Module['___gmpz_scan0']) abort("external function '__gmpz_scan0' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_scan0'].apply(null, arguments);
  }

  function ___gmpz_scan1(
  ) {
  if (!Module['___gmpz_scan1']) abort("external function '__gmpz_scan1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_scan1'].apply(null, arguments);
  }

  function ___gmpz_set(
  ) {
  if (!Module['___gmpz_set']) abort("external function '__gmpz_set' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_set'].apply(null, arguments);
  }

  function ___gmpz_set_d(
  ) {
  if (!Module['___gmpz_set_d']) abort("external function '__gmpz_set_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_set_d'].apply(null, arguments);
  }

  function ___gmpz_set_f(
  ) {
  if (!Module['___gmpz_set_f']) abort("external function '__gmpz_set_f' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_set_f'].apply(null, arguments);
  }

  function ___gmpz_set_q(
  ) {
  if (!Module['___gmpz_set_q']) abort("external function '__gmpz_set_q' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_set_q'].apply(null, arguments);
  }

  function ___gmpz_set_si(
  ) {
  if (!Module['___gmpz_set_si']) abort("external function '__gmpz_set_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_set_si'].apply(null, arguments);
  }

  function ___gmpz_set_str(
  ) {
  if (!Module['___gmpz_set_str']) abort("external function '__gmpz_set_str' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_set_str'].apply(null, arguments);
  }

  function ___gmpz_set_ui(
  ) {
  if (!Module['___gmpz_set_ui']) abort("external function '__gmpz_set_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_set_ui'].apply(null, arguments);
  }

  function ___gmpz_setbit(
  ) {
  if (!Module['___gmpz_setbit']) abort("external function '__gmpz_setbit' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_setbit'].apply(null, arguments);
  }

  function ___gmpz_si_kronecker(
  ) {
  if (!Module['___gmpz_si_kronecker']) abort("external function '__gmpz_si_kronecker' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_si_kronecker'].apply(null, arguments);
  }

  function ___gmpz_size(
  ) {
  if (!Module['___gmpz_size']) abort("external function '__gmpz_size' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_size'].apply(null, arguments);
  }

  function ___gmpz_sizeinbase(
  ) {
  if (!Module['___gmpz_sizeinbase']) abort("external function '__gmpz_sizeinbase' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_sizeinbase'].apply(null, arguments);
  }

  function ___gmpz_sqrt(
  ) {
  if (!Module['___gmpz_sqrt']) abort("external function '__gmpz_sqrt' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_sqrt'].apply(null, arguments);
  }

  function ___gmpz_sqrtrem(
  ) {
  if (!Module['___gmpz_sqrtrem']) abort("external function '__gmpz_sqrtrem' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_sqrtrem'].apply(null, arguments);
  }

  function ___gmpz_sub(
  ) {
  if (!Module['___gmpz_sub']) abort("external function '__gmpz_sub' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_sub'].apply(null, arguments);
  }

  function ___gmpz_sub_ui(
  ) {
  if (!Module['___gmpz_sub_ui']) abort("external function '__gmpz_sub_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_sub_ui'].apply(null, arguments);
  }

  function ___gmpz_submul(
  ) {
  if (!Module['___gmpz_submul']) abort("external function '__gmpz_submul' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_submul'].apply(null, arguments);
  }

  function ___gmpz_submul_ui(
  ) {
  if (!Module['___gmpz_submul_ui']) abort("external function '__gmpz_submul_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_submul_ui'].apply(null, arguments);
  }

  function ___gmpz_swap(
  ) {
  if (!Module['___gmpz_swap']) abort("external function '__gmpz_swap' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_swap'].apply(null, arguments);
  }

  function ___gmpz_tdiv_q(
  ) {
  if (!Module['___gmpz_tdiv_q']) abort("external function '__gmpz_tdiv_q' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_tdiv_q'].apply(null, arguments);
  }

  function ___gmpz_tdiv_q_2exp(
  ) {
  if (!Module['___gmpz_tdiv_q_2exp']) abort("external function '__gmpz_tdiv_q_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_tdiv_q_2exp'].apply(null, arguments);
  }

  function ___gmpz_tdiv_q_ui(
  ) {
  if (!Module['___gmpz_tdiv_q_ui']) abort("external function '__gmpz_tdiv_q_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_tdiv_q_ui'].apply(null, arguments);
  }

  function ___gmpz_tdiv_qr(
  ) {
  if (!Module['___gmpz_tdiv_qr']) abort("external function '__gmpz_tdiv_qr' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_tdiv_qr'].apply(null, arguments);
  }

  function ___gmpz_tdiv_qr_ui(
  ) {
  if (!Module['___gmpz_tdiv_qr_ui']) abort("external function '__gmpz_tdiv_qr_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_tdiv_qr_ui'].apply(null, arguments);
  }

  function ___gmpz_tdiv_r(
  ) {
  if (!Module['___gmpz_tdiv_r']) abort("external function '__gmpz_tdiv_r' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_tdiv_r'].apply(null, arguments);
  }

  function ___gmpz_tdiv_r_2exp(
  ) {
  if (!Module['___gmpz_tdiv_r_2exp']) abort("external function '__gmpz_tdiv_r_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_tdiv_r_2exp'].apply(null, arguments);
  }

  function ___gmpz_tdiv_r_ui(
  ) {
  if (!Module['___gmpz_tdiv_r_ui']) abort("external function '__gmpz_tdiv_r_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_tdiv_r_ui'].apply(null, arguments);
  }

  function ___gmpz_tdiv_ui(
  ) {
  if (!Module['___gmpz_tdiv_ui']) abort("external function '__gmpz_tdiv_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_tdiv_ui'].apply(null, arguments);
  }

  function ___gmpz_tstbit(
  ) {
  if (!Module['___gmpz_tstbit']) abort("external function '__gmpz_tstbit' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_tstbit'].apply(null, arguments);
  }

  function ___gmpz_ui_kronecker(
  ) {
  if (!Module['___gmpz_ui_kronecker']) abort("external function '__gmpz_ui_kronecker' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_ui_kronecker'].apply(null, arguments);
  }

  function ___gmpz_ui_pow_ui(
  ) {
  if (!Module['___gmpz_ui_pow_ui']) abort("external function '__gmpz_ui_pow_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_ui_pow_ui'].apply(null, arguments);
  }

  function ___gmpz_ui_sub(
  ) {
  if (!Module['___gmpz_ui_sub']) abort("external function '__gmpz_ui_sub' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_ui_sub'].apply(null, arguments);
  }

  function ___gmpz_urandomb(
  ) {
  if (!Module['___gmpz_urandomb']) abort("external function '__gmpz_urandomb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_urandomb'].apply(null, arguments);
  }

  function ___gmpz_urandomm(
  ) {
  if (!Module['___gmpz_urandomm']) abort("external function '__gmpz_urandomm' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_urandomm'].apply(null, arguments);
  }

  function ___gmpz_xor(
  ) {
  if (!Module['___gmpz_xor']) abort("external function '__gmpz_xor' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmpz_xor'].apply(null, arguments);
  }

  function ___lock() {}

  function ___map_file(pathname, size) {
      ___setErrNo(1);
      return -1;
    }

  
    

   

  
  
  
  var PATH={splitPath:function(filename) {
        var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
        return splitPathRe.exec(filename).slice(1);
      },normalizeArray:function(parts, allowAboveRoot) {
        // if the path tries to go above the root, `up` ends up > 0
        var up = 0;
        for (var i = parts.length - 1; i >= 0; i--) {
          var last = parts[i];
          if (last === '.') {
            parts.splice(i, 1);
          } else if (last === '..') {
            parts.splice(i, 1);
            up++;
          } else if (up) {
            parts.splice(i, 1);
            up--;
          }
        }
        // if the path is allowed to go above the root, restore leading ..s
        if (allowAboveRoot) {
          for (; up; up--) {
            parts.unshift('..');
          }
        }
        return parts;
      },normalize:function(path) {
        var isAbsolute = path.charAt(0) === '/',
            trailingSlash = path.substr(-1) === '/';
        // Normalize the path
        path = PATH.normalizeArray(path.split('/').filter(function(p) {
          return !!p;
        }), !isAbsolute).join('/');
        if (!path && !isAbsolute) {
          path = '.';
        }
        if (path && trailingSlash) {
          path += '/';
        }
        return (isAbsolute ? '/' : '') + path;
      },dirname:function(path) {
        var result = PATH.splitPath(path),
            root = result[0],
            dir = result[1];
        if (!root && !dir) {
          // No dirname whatsoever
          return '.';
        }
        if (dir) {
          // It has a dirname, strip trailing slash
          dir = dir.substr(0, dir.length - 1);
        }
        return root + dir;
      },basename:function(path) {
        // EMSCRIPTEN return '/'' for '/', not an empty string
        if (path === '/') return '/';
        var lastSlash = path.lastIndexOf('/');
        if (lastSlash === -1) return path;
        return path.substr(lastSlash+1);
      },extname:function(path) {
        return PATH.splitPath(path)[3];
      },join:function() {
        var paths = Array.prototype.slice.call(arguments, 0);
        return PATH.normalize(paths.join('/'));
      },join2:function(l, r) {
        return PATH.normalize(l + '/' + r);
      },resolve:function() {
        var resolvedPath = '',
          resolvedAbsolute = false;
        for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
          var path = (i >= 0) ? arguments[i] : FS.cwd();
          // Skip empty and invalid entries
          if (typeof path !== 'string') {
            throw new TypeError('Arguments to path.resolve must be strings');
          } else if (!path) {
            return ''; // an invalid portion invalidates the whole thing
          }
          resolvedPath = path + '/' + resolvedPath;
          resolvedAbsolute = path.charAt(0) === '/';
        }
        // At this point the path should be resolved to a full absolute path, but
        // handle relative paths to be safe (might happen when process.cwd() fails)
        resolvedPath = PATH.normalizeArray(resolvedPath.split('/').filter(function(p) {
          return !!p;
        }), !resolvedAbsolute).join('/');
        return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
      },relative:function(from, to) {
        from = PATH.resolve(from).substr(1);
        to = PATH.resolve(to).substr(1);
        function trim(arr) {
          var start = 0;
          for (; start < arr.length; start++) {
            if (arr[start] !== '') break;
          }
          var end = arr.length - 1;
          for (; end >= 0; end--) {
            if (arr[end] !== '') break;
          }
          if (start > end) return [];
          return arr.slice(start, end - start + 1);
        }
        var fromParts = trim(from.split('/'));
        var toParts = trim(to.split('/'));
        var length = Math.min(fromParts.length, toParts.length);
        var samePartsLength = length;
        for (var i = 0; i < length; i++) {
          if (fromParts[i] !== toParts[i]) {
            samePartsLength = i;
            break;
          }
        }
        var outputParts = [];
        for (var i = samePartsLength; i < fromParts.length; i++) {
          outputParts.push('..');
        }
        outputParts = outputParts.concat(toParts.slice(samePartsLength));
        return outputParts.join('/');
      }};
  
  var TTY={ttys:[],init:function () {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // currently, FS.init does not distinguish if process.stdin is a file or TTY
        //   // device, it always assumes it's a TTY device. because of this, we're forcing
        //   // process.stdin to UTF8 encoding to at least make stdin reading compatible
        //   // with text files until FS.init can be refactored.
        //   process['stdin']['setEncoding']('utf8');
        // }
      },shutdown:function() {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // inolen: any idea as to why node -e 'process.stdin.read()' wouldn't exit immediately (with process.stdin being a tty)?
        //   // isaacs: because now it's reading from the stream, you've expressed interest in it, so that read() kicks off a _read() which creates a ReadReq operation
        //   // inolen: I thought read() in that case was a synchronous operation that just grabbed some amount of buffered data if it exists?
        //   // isaacs: it is. but it also triggers a _read() call, which calls readStart() on the handle
        //   // isaacs: do process.stdin.pause() and i'd think it'd probably close the pending call
        //   process['stdin']['pause']();
        // }
      },register:function(dev, ops) {
        TTY.ttys[dev] = { input: [], output: [], ops: ops };
        FS.registerDevice(dev, TTY.stream_ops);
      },stream_ops:{open:function(stream) {
          var tty = TTY.ttys[stream.node.rdev];
          if (!tty) {
            throw new FS.ErrnoError(19);
          }
          stream.tty = tty;
          stream.seekable = false;
        },close:function(stream) {
          // flush any pending line data
          stream.tty.ops.flush(stream.tty);
        },flush:function(stream) {
          stream.tty.ops.flush(stream.tty);
        },read:function(stream, buffer, offset, length, pos /* ignored */) {
          if (!stream.tty || !stream.tty.ops.get_char) {
            throw new FS.ErrnoError(6);
          }
          var bytesRead = 0;
          for (var i = 0; i < length; i++) {
            var result;
            try {
              result = stream.tty.ops.get_char(stream.tty);
            } catch (e) {
              throw new FS.ErrnoError(5);
            }
            if (result === undefined && bytesRead === 0) {
              throw new FS.ErrnoError(11);
            }
            if (result === null || result === undefined) break;
            bytesRead++;
            buffer[offset+i] = result;
          }
          if (bytesRead) {
            stream.node.timestamp = Date.now();
          }
          return bytesRead;
        },write:function(stream, buffer, offset, length, pos) {
          if (!stream.tty || !stream.tty.ops.put_char) {
            throw new FS.ErrnoError(6);
          }
          try {
            for (var i = 0; i < length; i++) {
              stream.tty.ops.put_char(stream.tty, buffer[offset+i]);
            }
          } catch (e) {
            throw new FS.ErrnoError(5);
          }
          if (length) {
            stream.node.timestamp = Date.now();
          }
          return i;
        }},default_tty_ops:{get_char:function(tty) {
          if (!tty.input.length) {
            var result = null;
            if (ENVIRONMENT_IS_NODE) {
              // we will read data by chunks of BUFSIZE
              var BUFSIZE = 256;
              var buf = new Buffer(BUFSIZE);
              var bytesRead = 0;
  
              var isPosixPlatform = (process.platform != 'win32'); // Node doesn't offer a direct check, so test by exclusion
  
              var fd = process.stdin.fd;
              if (isPosixPlatform) {
                // Linux and Mac cannot use process.stdin.fd (which isn't set up as sync)
                var usingDevice = false;
                try {
                  fd = fs.openSync('/dev/stdin', 'r');
                  usingDevice = true;
                } catch (e) {}
              }
  
              try {
                bytesRead = fs.readSync(fd, buf, 0, BUFSIZE, null);
              } catch(e) {
                // Cross-platform differences: on Windows, reading EOF throws an exception, but on other OSes,
                // reading EOF returns 0. Uniformize behavior by treating the EOF exception to return 0.
                if (e.toString().indexOf('EOF') != -1) bytesRead = 0;
                else throw e;
              }
  
              if (usingDevice) { fs.closeSync(fd); }
              if (bytesRead > 0) {
                result = buf.slice(0, bytesRead).toString('utf-8');
              } else {
                result = null;
              }
            } else
            if (typeof window != 'undefined' &&
              typeof window.prompt == 'function') {
              // Browser.
              result = window.prompt('Input: ');  // returns null on cancel
              if (result !== null) {
                result += '\n';
              }
            } else if (typeof readline == 'function') {
              // Command line.
              result = readline();
              if (result !== null) {
                result += '\n';
              }
            }
            if (!result) {
              return null;
            }
            tty.input = intArrayFromString(result, true);
          }
          return tty.input.shift();
        },put_char:function(tty, val) {
          if (val === null || val === 10) {
            out(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val); // val == 0 would cut text output off in the middle.
          }
        },flush:function(tty) {
          if (tty.output && tty.output.length > 0) {
            out(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          }
        }},default_tty1_ops:{put_char:function(tty, val) {
          if (val === null || val === 10) {
            err(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val);
          }
        },flush:function(tty) {
          if (tty.output && tty.output.length > 0) {
            err(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          }
        }}};
  
  var MEMFS={ops_table:null,mount:function(mount) {
        return MEMFS.createNode(null, '/', 16384 | 511 /* 0777 */, 0);
      },createNode:function(parent, name, mode, dev) {
        if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
          // no supported
          throw new FS.ErrnoError(1);
        }
        if (!MEMFS.ops_table) {
          MEMFS.ops_table = {
            dir: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr,
                lookup: MEMFS.node_ops.lookup,
                mknod: MEMFS.node_ops.mknod,
                rename: MEMFS.node_ops.rename,
                unlink: MEMFS.node_ops.unlink,
                rmdir: MEMFS.node_ops.rmdir,
                readdir: MEMFS.node_ops.readdir,
                symlink: MEMFS.node_ops.symlink
              },
              stream: {
                llseek: MEMFS.stream_ops.llseek
              }
            },
            file: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr
              },
              stream: {
                llseek: MEMFS.stream_ops.llseek,
                read: MEMFS.stream_ops.read,
                write: MEMFS.stream_ops.write,
                allocate: MEMFS.stream_ops.allocate,
                mmap: MEMFS.stream_ops.mmap,
                msync: MEMFS.stream_ops.msync
              }
            },
            link: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr,
                readlink: MEMFS.node_ops.readlink
              },
              stream: {}
            },
            chrdev: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr
              },
              stream: FS.chrdev_stream_ops
            }
          };
        }
        var node = FS.createNode(parent, name, mode, dev);
        if (FS.isDir(node.mode)) {
          node.node_ops = MEMFS.ops_table.dir.node;
          node.stream_ops = MEMFS.ops_table.dir.stream;
          node.contents = {};
        } else if (FS.isFile(node.mode)) {
          node.node_ops = MEMFS.ops_table.file.node;
          node.stream_ops = MEMFS.ops_table.file.stream;
          node.usedBytes = 0; // The actual number of bytes used in the typed array, as opposed to contents.length which gives the whole capacity.
          // When the byte data of the file is populated, this will point to either a typed array, or a normal JS array. Typed arrays are preferred
          // for performance, and used by default. However, typed arrays are not resizable like normal JS arrays are, so there is a small disk size
          // penalty involved for appending file writes that continuously grow a file similar to std::vector capacity vs used -scheme.
          node.contents = null; 
        } else if (FS.isLink(node.mode)) {
          node.node_ops = MEMFS.ops_table.link.node;
          node.stream_ops = MEMFS.ops_table.link.stream;
        } else if (FS.isChrdev(node.mode)) {
          node.node_ops = MEMFS.ops_table.chrdev.node;
          node.stream_ops = MEMFS.ops_table.chrdev.stream;
        }
        node.timestamp = Date.now();
        // add the new node to the parent
        if (parent) {
          parent.contents[name] = node;
        }
        return node;
      },getFileDataAsRegularArray:function(node) {
        if (node.contents && node.contents.subarray) {
          var arr = [];
          for (var i = 0; i < node.usedBytes; ++i) arr.push(node.contents[i]);
          return arr; // Returns a copy of the original data.
        }
        return node.contents; // No-op, the file contents are already in a JS array. Return as-is.
      },getFileDataAsTypedArray:function(node) {
        if (!node.contents) return new Uint8Array;
        if (node.contents.subarray) return node.contents.subarray(0, node.usedBytes); // Make sure to not return excess unused bytes.
        return new Uint8Array(node.contents);
      },expandFileStorage:function(node, newCapacity) {
        var prevCapacity = node.contents ? node.contents.length : 0;
        if (prevCapacity >= newCapacity) return; // No need to expand, the storage was already large enough.
        // Don't expand strictly to the given requested limit if it's only a very small increase, but instead geometrically grow capacity.
        // For small filesizes (<1MB), perform size*2 geometric increase, but for large sizes, do a much more conservative size*1.125 increase to
        // avoid overshooting the allocation cap by a very large margin.
        var CAPACITY_DOUBLING_MAX = 1024 * 1024;
        newCapacity = Math.max(newCapacity, (prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2.0 : 1.125)) | 0);
        if (prevCapacity != 0) newCapacity = Math.max(newCapacity, 256); // At minimum allocate 256b for each file when expanding.
        var oldContents = node.contents;
        node.contents = new Uint8Array(newCapacity); // Allocate new storage.
        if (node.usedBytes > 0) node.contents.set(oldContents.subarray(0, node.usedBytes), 0); // Copy old data over to the new storage.
        return;
      },resizeFileStorage:function(node, newSize) {
        if (node.usedBytes == newSize) return;
        if (newSize == 0) {
          node.contents = null; // Fully decommit when requesting a resize to zero.
          node.usedBytes = 0;
          return;
        }
        if (!node.contents || node.contents.subarray) { // Resize a typed array if that is being used as the backing store.
          var oldContents = node.contents;
          node.contents = new Uint8Array(new ArrayBuffer(newSize)); // Allocate new storage.
          if (oldContents) {
            node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes))); // Copy old data over to the new storage.
          }
          node.usedBytes = newSize;
          return;
        }
        // Backing with a JS array.
        if (!node.contents) node.contents = [];
        if (node.contents.length > newSize) node.contents.length = newSize;
        else while (node.contents.length < newSize) node.contents.push(0);
        node.usedBytes = newSize;
      },node_ops:{getattr:function(node) {
          var attr = {};
          // device numbers reuse inode numbers.
          attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
          attr.ino = node.id;
          attr.mode = node.mode;
          attr.nlink = 1;
          attr.uid = 0;
          attr.gid = 0;
          attr.rdev = node.rdev;
          if (FS.isDir(node.mode)) {
            attr.size = 4096;
          } else if (FS.isFile(node.mode)) {
            attr.size = node.usedBytes;
          } else if (FS.isLink(node.mode)) {
            attr.size = node.link.length;
          } else {
            attr.size = 0;
          }
          attr.atime = new Date(node.timestamp);
          attr.mtime = new Date(node.timestamp);
          attr.ctime = new Date(node.timestamp);
          // NOTE: In our implementation, st_blocks = Math.ceil(st_size/st_blksize),
          //       but this is not required by the standard.
          attr.blksize = 4096;
          attr.blocks = Math.ceil(attr.size / attr.blksize);
          return attr;
        },setattr:function(node, attr) {
          if (attr.mode !== undefined) {
            node.mode = attr.mode;
          }
          if (attr.timestamp !== undefined) {
            node.timestamp = attr.timestamp;
          }
          if (attr.size !== undefined) {
            MEMFS.resizeFileStorage(node, attr.size);
          }
        },lookup:function(parent, name) {
          throw FS.genericErrors[2];
        },mknod:function(parent, name, mode, dev) {
          return MEMFS.createNode(parent, name, mode, dev);
        },rename:function(old_node, new_dir, new_name) {
          // if we're overwriting a directory at new_name, make sure it's empty.
          if (FS.isDir(old_node.mode)) {
            var new_node;
            try {
              new_node = FS.lookupNode(new_dir, new_name);
            } catch (e) {
            }
            if (new_node) {
              for (var i in new_node.contents) {
                throw new FS.ErrnoError(39);
              }
            }
          }
          // do the internal rewiring
          delete old_node.parent.contents[old_node.name];
          old_node.name = new_name;
          new_dir.contents[new_name] = old_node;
          old_node.parent = new_dir;
        },unlink:function(parent, name) {
          delete parent.contents[name];
        },rmdir:function(parent, name) {
          var node = FS.lookupNode(parent, name);
          for (var i in node.contents) {
            throw new FS.ErrnoError(39);
          }
          delete parent.contents[name];
        },readdir:function(node) {
          var entries = ['.', '..']
          for (var key in node.contents) {
            if (!node.contents.hasOwnProperty(key)) {
              continue;
            }
            entries.push(key);
          }
          return entries;
        },symlink:function(parent, newname, oldpath) {
          var node = MEMFS.createNode(parent, newname, 511 /* 0777 */ | 40960, 0);
          node.link = oldpath;
          return node;
        },readlink:function(node) {
          if (!FS.isLink(node.mode)) {
            throw new FS.ErrnoError(22);
          }
          return node.link;
        }},stream_ops:{read:function(stream, buffer, offset, length, position) {
          var contents = stream.node.contents;
          if (position >= stream.node.usedBytes) return 0;
          var size = Math.min(stream.node.usedBytes - position, length);
          assert(size >= 0);
          if (size > 8 && contents.subarray) { // non-trivial, and typed array
            buffer.set(contents.subarray(position, position + size), offset);
          } else {
            for (var i = 0; i < size; i++) buffer[offset + i] = contents[position + i];
          }
          return size;
        },write:function(stream, buffer, offset, length, position, canOwn) {
          // If memory can grow, we don't want to hold on to references of
          // the memory Buffer, as they may get invalidated. That means
          // we need to do a copy here.
          // FIXME: this is inefficient as the file packager may have
          //        copied the data into memory already - we may want to
          //        integrate more there and let the file packager loading
          //        code be able to query if memory growth is on or off.
          if (canOwn) {
            warnOnce('file packager has copied file data into memory, but in memory growth we are forced to copy it again (see --no-heap-copy)');
          }
          canOwn = false;
  
          if (!length) return 0;
          var node = stream.node;
          node.timestamp = Date.now();
  
          if (buffer.subarray && (!node.contents || node.contents.subarray)) { // This write is from a typed array to a typed array?
            if (canOwn) {
              assert(position === 0, 'canOwn must imply no weird position inside the file');
              node.contents = buffer.subarray(offset, offset + length);
              node.usedBytes = length;
              return length;
            } else if (node.usedBytes === 0 && position === 0) { // If this is a simple first write to an empty file, do a fast set since we don't need to care about old data.
              node.contents = new Uint8Array(buffer.subarray(offset, offset + length));
              node.usedBytes = length;
              return length;
            } else if (position + length <= node.usedBytes) { // Writing to an already allocated and used subrange of the file?
              node.contents.set(buffer.subarray(offset, offset + length), position);
              return length;
            }
          }
  
          // Appending to an existing file and we need to reallocate, or source data did not come as a typed array.
          MEMFS.expandFileStorage(node, position+length);
          if (node.contents.subarray && buffer.subarray) node.contents.set(buffer.subarray(offset, offset + length), position); // Use typed array write if available.
          else {
            for (var i = 0; i < length; i++) {
             node.contents[position + i] = buffer[offset + i]; // Or fall back to manual write if not.
            }
          }
          node.usedBytes = Math.max(node.usedBytes, position+length);
          return length;
        },llseek:function(stream, offset, whence) {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            if (FS.isFile(stream.node.mode)) {
              position += stream.node.usedBytes;
            }
          }
          if (position < 0) {
            throw new FS.ErrnoError(22);
          }
          return position;
        },allocate:function(stream, offset, length) {
          MEMFS.expandFileStorage(stream.node, offset + length);
          stream.node.usedBytes = Math.max(stream.node.usedBytes, offset + length);
        },mmap:function(stream, buffer, offset, length, position, prot, flags) {
          if (!FS.isFile(stream.node.mode)) {
            throw new FS.ErrnoError(19);
          }
          var ptr;
          var allocated;
          var contents = stream.node.contents;
          // Only make a new copy when MAP_PRIVATE is specified.
          if ( !(flags & 2) &&
                (contents.buffer === buffer || contents.buffer === buffer.buffer) ) {
            // We can't emulate MAP_SHARED when the file is not backed by the buffer
            // we're mapping to (e.g. the HEAP buffer).
            allocated = false;
            ptr = contents.byteOffset;
          } else {
            // Try to avoid unnecessary slices.
            if (position > 0 || position + length < stream.node.usedBytes) {
              if (contents.subarray) {
                contents = contents.subarray(position, position + length);
              } else {
                contents = Array.prototype.slice.call(contents, position, position + length);
              }
            }
            allocated = true;
            ptr = _malloc(length);
            if (!ptr) {
              throw new FS.ErrnoError(12);
            }
            buffer.set(contents, ptr);
          }
          return { ptr: ptr, allocated: allocated };
        },msync:function(stream, buffer, offset, length, mmapFlags) {
          if (!FS.isFile(stream.node.mode)) {
            throw new FS.ErrnoError(19);
          }
          if (mmapFlags & 2) {
            // MAP_PRIVATE calls need not to be synced back to underlying fs
            return 0;
          }
  
          var bytesWritten = MEMFS.stream_ops.write(stream, buffer, 0, length, offset, false);
          // should we check if bytesWritten and length are the same?
          return 0;
        }}};
  
  var IDBFS={dbs:{},indexedDB:function() {
        if (typeof indexedDB !== 'undefined') return indexedDB;
        var ret = null;
        if (typeof window === 'object') ret = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
        assert(ret, 'IDBFS used, but indexedDB not supported');
        return ret;
      },DB_VERSION:21,DB_STORE_NAME:"FILE_DATA",mount:function(mount) {
        // reuse all of the core MEMFS functionality
        return MEMFS.mount.apply(null, arguments);
      },syncfs:function(mount, populate, callback) {
        IDBFS.getLocalSet(mount, function(err, local) {
          if (err) return callback(err);
  
          IDBFS.getRemoteSet(mount, function(err, remote) {
            if (err) return callback(err);
  
            var src = populate ? remote : local;
            var dst = populate ? local : remote;
  
            IDBFS.reconcile(src, dst, callback);
          });
        });
      },getDB:function(name, callback) {
        // check the cache first
        var db = IDBFS.dbs[name];
        if (db) {
          return callback(null, db);
        }
  
        var req;
        try {
          req = IDBFS.indexedDB().open(name, IDBFS.DB_VERSION);
        } catch (e) {
          return callback(e);
        }
        if (!req) {
          return callback("Unable to connect to IndexedDB");
        }
        req.onupgradeneeded = function(e) {
          var db = e.target.result;
          var transaction = e.target.transaction;
  
          var fileStore;
  
          if (db.objectStoreNames.contains(IDBFS.DB_STORE_NAME)) {
            fileStore = transaction.objectStore(IDBFS.DB_STORE_NAME);
          } else {
            fileStore = db.createObjectStore(IDBFS.DB_STORE_NAME);
          }
  
          if (!fileStore.indexNames.contains('timestamp')) {
            fileStore.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };
        req.onsuccess = function() {
          db = req.result;
  
          // add to the cache
          IDBFS.dbs[name] = db;
          callback(null, db);
        };
        req.onerror = function(e) {
          callback(this.error);
          e.preventDefault();
        };
      },getLocalSet:function(mount, callback) {
        var entries = {};
  
        function isRealDir(p) {
          return p !== '.' && p !== '..';
        };
        function toAbsolute(root) {
          return function(p) {
            return PATH.join2(root, p);
          }
        };
  
        var check = FS.readdir(mount.mountpoint).filter(isRealDir).map(toAbsolute(mount.mountpoint));
  
        while (check.length) {
          var path = check.pop();
          var stat;
  
          try {
            stat = FS.stat(path);
          } catch (e) {
            return callback(e);
          }
  
          if (FS.isDir(stat.mode)) {
            check.push.apply(check, FS.readdir(path).filter(isRealDir).map(toAbsolute(path)));
          }
  
          entries[path] = { timestamp: stat.mtime };
        }
  
        return callback(null, { type: 'local', entries: entries });
      },getRemoteSet:function(mount, callback) {
        var entries = {};
  
        IDBFS.getDB(mount.mountpoint, function(err, db) {
          if (err) return callback(err);
  
          try {
            var transaction = db.transaction([IDBFS.DB_STORE_NAME], 'readonly');
            transaction.onerror = function(e) {
              callback(this.error);
              e.preventDefault();
            };
  
            var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
            var index = store.index('timestamp');
  
            index.openKeyCursor().onsuccess = function(event) {
              var cursor = event.target.result;
  
              if (!cursor) {
                return callback(null, { type: 'remote', db: db, entries: entries });
              }
  
              entries[cursor.primaryKey] = { timestamp: cursor.key };
  
              cursor.continue();
            };
          } catch (e) {
            return callback(e);
          }
        });
      },loadLocalEntry:function(path, callback) {
        var stat, node;
  
        try {
          var lookup = FS.lookupPath(path);
          node = lookup.node;
          stat = FS.stat(path);
        } catch (e) {
          return callback(e);
        }
  
        if (FS.isDir(stat.mode)) {
          return callback(null, { timestamp: stat.mtime, mode: stat.mode });
        } else if (FS.isFile(stat.mode)) {
          // Performance consideration: storing a normal JavaScript array to a IndexedDB is much slower than storing a typed array.
          // Therefore always convert the file contents to a typed array first before writing the data to IndexedDB.
          node.contents = MEMFS.getFileDataAsTypedArray(node);
          return callback(null, { timestamp: stat.mtime, mode: stat.mode, contents: node.contents });
        } else {
          return callback(new Error('node type not supported'));
        }
      },storeLocalEntry:function(path, entry, callback) {
        try {
          if (FS.isDir(entry.mode)) {
            FS.mkdir(path, entry.mode);
          } else if (FS.isFile(entry.mode)) {
            FS.writeFile(path, entry.contents, { canOwn: true });
          } else {
            return callback(new Error('node type not supported'));
          }
  
          FS.chmod(path, entry.mode);
          FS.utime(path, entry.timestamp, entry.timestamp);
        } catch (e) {
          return callback(e);
        }
  
        callback(null);
      },removeLocalEntry:function(path, callback) {
        try {
          var lookup = FS.lookupPath(path);
          var stat = FS.stat(path);
  
          if (FS.isDir(stat.mode)) {
            FS.rmdir(path);
          } else if (FS.isFile(stat.mode)) {
            FS.unlink(path);
          }
        } catch (e) {
          return callback(e);
        }
  
        callback(null);
      },loadRemoteEntry:function(store, path, callback) {
        var req = store.get(path);
        req.onsuccess = function(event) { callback(null, event.target.result); };
        req.onerror = function(e) {
          callback(this.error);
          e.preventDefault();
        };
      },storeRemoteEntry:function(store, path, entry, callback) {
        var req = store.put(entry, path);
        req.onsuccess = function() { callback(null); };
        req.onerror = function(e) {
          callback(this.error);
          e.preventDefault();
        };
      },removeRemoteEntry:function(store, path, callback) {
        var req = store.delete(path);
        req.onsuccess = function() { callback(null); };
        req.onerror = function(e) {
          callback(this.error);
          e.preventDefault();
        };
      },reconcile:function(src, dst, callback) {
        var total = 0;
  
        var create = [];
        Object.keys(src.entries).forEach(function (key) {
          var e = src.entries[key];
          var e2 = dst.entries[key];
          if (!e2 || e.timestamp > e2.timestamp) {
            create.push(key);
            total++;
          }
        });
  
        var remove = [];
        Object.keys(dst.entries).forEach(function (key) {
          var e = dst.entries[key];
          var e2 = src.entries[key];
          if (!e2) {
            remove.push(key);
            total++;
          }
        });
  
        if (!total) {
          return callback(null);
        }
  
        var errored = false;
        var completed = 0;
        var db = src.type === 'remote' ? src.db : dst.db;
        var transaction = db.transaction([IDBFS.DB_STORE_NAME], 'readwrite');
        var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
  
        function done(err) {
          if (err) {
            if (!done.errored) {
              done.errored = true;
              return callback(err);
            }
            return;
          }
          if (++completed >= total) {
            return callback(null);
          }
        };
  
        transaction.onerror = function(e) {
          done(this.error);
          e.preventDefault();
        };
  
        // sort paths in ascending order so directory entries are created
        // before the files inside them
        create.sort().forEach(function (path) {
          if (dst.type === 'local') {
            IDBFS.loadRemoteEntry(store, path, function (err, entry) {
              if (err) return done(err);
              IDBFS.storeLocalEntry(path, entry, done);
            });
          } else {
            IDBFS.loadLocalEntry(path, function (err, entry) {
              if (err) return done(err);
              IDBFS.storeRemoteEntry(store, path, entry, done);
            });
          }
        });
  
        // sort paths in descending order so files are deleted before their
        // parent directories
        remove.sort().reverse().forEach(function(path) {
          if (dst.type === 'local') {
            IDBFS.removeLocalEntry(path, done);
          } else {
            IDBFS.removeRemoteEntry(store, path, done);
          }
        });
      }};
  
  var NODEFS={isWindows:false,staticInit:function() {
        NODEFS.isWindows = !!process.platform.match(/^win/);
        var flags = process["binding"]("constants");
        // Node.js 4 compatibility: it has no namespaces for constants
        if (flags["fs"]) {
          flags = flags["fs"];
        }
        NODEFS.flagsForNodeMap = {
          "1024": flags["O_APPEND"],
          "64": flags["O_CREAT"],
          "128": flags["O_EXCL"],
          "0": flags["O_RDONLY"],
          "2": flags["O_RDWR"],
          "4096": flags["O_SYNC"],
          "512": flags["O_TRUNC"],
          "1": flags["O_WRONLY"]
        };
      },bufferFrom:function (arrayBuffer) {
        // Node.js < 4.5 compatibility: Buffer.from does not support ArrayBuffer
        // Buffer.from before 4.5 was just a method inherited from Uint8Array
        // Buffer.alloc has been added with Buffer.from together, so check it instead
        return Buffer.alloc ? Buffer.from(arrayBuffer) : new Buffer(arrayBuffer);
      },mount:function (mount) {
        assert(ENVIRONMENT_IS_NODE);
        return NODEFS.createNode(null, '/', NODEFS.getMode(mount.opts.root), 0);
      },createNode:function (parent, name, mode, dev) {
        if (!FS.isDir(mode) && !FS.isFile(mode) && !FS.isLink(mode)) {
          throw new FS.ErrnoError(22);
        }
        var node = FS.createNode(parent, name, mode);
        node.node_ops = NODEFS.node_ops;
        node.stream_ops = NODEFS.stream_ops;
        return node;
      },getMode:function (path) {
        var stat;
        try {
          stat = fs.lstatSync(path);
          if (NODEFS.isWindows) {
            // Node.js on Windows never represents permission bit 'x', so
            // propagate read bits to execute bits
            stat.mode = stat.mode | ((stat.mode & 292) >> 2);
          }
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(-e.errno); // syscall errnos are negated, node's are not
        }
        return stat.mode;
      },realPath:function (node) {
        var parts = [];
        while (node.parent !== node) {
          parts.push(node.name);
          node = node.parent;
        }
        parts.push(node.mount.opts.root);
        parts.reverse();
        return PATH.join.apply(null, parts);
      },flagsForNode:function(flags) {
        flags &= ~0x200000 /*O_PATH*/; // Ignore this flag from musl, otherwise node.js fails to open the file.
        flags &= ~0x800 /*O_NONBLOCK*/; // Ignore this flag from musl, otherwise node.js fails to open the file.
        flags &= ~0x8000 /*O_LARGEFILE*/; // Ignore this flag from musl, otherwise node.js fails to open the file.
        flags &= ~0x80000 /*O_CLOEXEC*/; // Some applications may pass it; it makes no sense for a single process.
        var newFlags = 0;
        for (var k in NODEFS.flagsForNodeMap) {
          if (flags & k) {
            newFlags |= NODEFS.flagsForNodeMap[k];
            flags ^= k;
          }
        }
  
        if (!flags) {
          return newFlags;
        } else {
          throw new FS.ErrnoError(22);
        }
      },node_ops:{getattr:function(node) {
          var path = NODEFS.realPath(node);
          var stat;
          try {
            stat = fs.lstatSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
          // node.js v0.10.20 doesn't report blksize and blocks on Windows. Fake them with default blksize of 4096.
          // See http://support.microsoft.com/kb/140365
          if (NODEFS.isWindows && !stat.blksize) {
            stat.blksize = 4096;
          }
          if (NODEFS.isWindows && !stat.blocks) {
            stat.blocks = (stat.size+stat.blksize-1)/stat.blksize|0;
          }
          return {
            dev: stat.dev,
            ino: stat.ino,
            mode: stat.mode,
            nlink: stat.nlink,
            uid: stat.uid,
            gid: stat.gid,
            rdev: stat.rdev,
            size: stat.size,
            atime: stat.atime,
            mtime: stat.mtime,
            ctime: stat.ctime,
            blksize: stat.blksize,
            blocks: stat.blocks
          };
        },setattr:function(node, attr) {
          var path = NODEFS.realPath(node);
          try {
            if (attr.mode !== undefined) {
              fs.chmodSync(path, attr.mode);
              // update the common node structure mode as well
              node.mode = attr.mode;
            }
            if (attr.timestamp !== undefined) {
              var date = new Date(attr.timestamp);
              fs.utimesSync(path, date, date);
            }
            if (attr.size !== undefined) {
              fs.truncateSync(path, attr.size);
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
        },lookup:function (parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          var mode = NODEFS.getMode(path);
          return NODEFS.createNode(parent, name, mode);
        },mknod:function (parent, name, mode, dev) {
          var node = NODEFS.createNode(parent, name, mode, dev);
          // create the backing node for this in the fs root as well
          var path = NODEFS.realPath(node);
          try {
            if (FS.isDir(node.mode)) {
              fs.mkdirSync(path, node.mode);
            } else {
              fs.writeFileSync(path, '', { mode: node.mode });
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
          return node;
        },rename:function (oldNode, newDir, newName) {
          var oldPath = NODEFS.realPath(oldNode);
          var newPath = PATH.join2(NODEFS.realPath(newDir), newName);
          try {
            fs.renameSync(oldPath, newPath);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
        },unlink:function(parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          try {
            fs.unlinkSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
        },rmdir:function(parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          try {
            fs.rmdirSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
        },readdir:function(node) {
          var path = NODEFS.realPath(node);
          try {
            return fs.readdirSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
        },symlink:function(parent, newName, oldPath) {
          var newPath = PATH.join2(NODEFS.realPath(parent), newName);
          try {
            fs.symlinkSync(oldPath, newPath);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
        },readlink:function(node) {
          var path = NODEFS.realPath(node);
          try {
            path = fs.readlinkSync(path);
            path = NODEJS_PATH.relative(NODEJS_PATH.resolve(node.mount.opts.root), path);
            return path;
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
        }},stream_ops:{open:function (stream) {
          var path = NODEFS.realPath(stream.node);
          try {
            if (FS.isFile(stream.node.mode)) {
              stream.nfd = fs.openSync(path, NODEFS.flagsForNode(stream.flags));
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
        },close:function (stream) {
          try {
            if (FS.isFile(stream.node.mode) && stream.nfd) {
              fs.closeSync(stream.nfd);
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
        },read:function (stream, buffer, offset, length, position) {
          // Node.js < 6 compatibility: node errors on 0 length reads
          if (length === 0) return 0;
          try {
            return fs.readSync(stream.nfd, NODEFS.bufferFrom(buffer.buffer), offset, length, position);
          } catch (e) {
            throw new FS.ErrnoError(-e.errno);
          }
        },write:function (stream, buffer, offset, length, position) {
          try {
            return fs.writeSync(stream.nfd, NODEFS.bufferFrom(buffer.buffer), offset, length, position);
          } catch (e) {
            throw new FS.ErrnoError(-e.errno);
          }
        },llseek:function (stream, offset, whence) {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            if (FS.isFile(stream.node.mode)) {
              try {
                var stat = fs.fstatSync(stream.nfd);
                position += stat.size;
              } catch (e) {
                throw new FS.ErrnoError(-e.errno);
              }
            }
          }
  
          if (position < 0) {
            throw new FS.ErrnoError(22);
          }
  
          return position;
        }}};
  
  var WORKERFS={DIR_MODE:16895,FILE_MODE:33279,reader:null,mount:function (mount) {
        assert(ENVIRONMENT_IS_WORKER);
        if (!WORKERFS.reader) WORKERFS.reader = new FileReaderSync();
        var root = WORKERFS.createNode(null, '/', WORKERFS.DIR_MODE, 0);
        var createdParents = {};
        function ensureParent(path) {
          // return the parent node, creating subdirs as necessary
          var parts = path.split('/');
          var parent = root;
          for (var i = 0; i < parts.length-1; i++) {
            var curr = parts.slice(0, i+1).join('/');
            // Issue 4254: Using curr as a node name will prevent the node
            // from being found in FS.nameTable when FS.open is called on
            // a path which holds a child of this node,
            // given that all FS functions assume node names
            // are just their corresponding parts within their given path,
            // rather than incremental aggregates which include their parent's
            // directories.
            if (!createdParents[curr]) {
              createdParents[curr] = WORKERFS.createNode(parent, parts[i], WORKERFS.DIR_MODE, 0);
            }
            parent = createdParents[curr];
          }
          return parent;
        }
        function base(path) {
          var parts = path.split('/');
          return parts[parts.length-1];
        }
        // We also accept FileList here, by using Array.prototype
        Array.prototype.forEach.call(mount.opts["files"] || [], function(file) {
          WORKERFS.createNode(ensureParent(file.name), base(file.name), WORKERFS.FILE_MODE, 0, file, file.lastModifiedDate);
        });
        (mount.opts["blobs"] || []).forEach(function(obj) {
          WORKERFS.createNode(ensureParent(obj["name"]), base(obj["name"]), WORKERFS.FILE_MODE, 0, obj["data"]);
        });
        (mount.opts["packages"] || []).forEach(function(pack) {
          pack['metadata'].files.forEach(function(file) {
            var name = file.filename.substr(1); // remove initial slash
            WORKERFS.createNode(ensureParent(name), base(name), WORKERFS.FILE_MODE, 0, pack['blob'].slice(file.start, file.end));
          });
        });
        return root;
      },createNode:function (parent, name, mode, dev, contents, mtime) {
        var node = FS.createNode(parent, name, mode);
        node.mode = mode;
        node.node_ops = WORKERFS.node_ops;
        node.stream_ops = WORKERFS.stream_ops;
        node.timestamp = (mtime || new Date).getTime();
        assert(WORKERFS.FILE_MODE !== WORKERFS.DIR_MODE);
        if (mode === WORKERFS.FILE_MODE) {
          node.size = contents.size;
          node.contents = contents;
        } else {
          node.size = 4096;
          node.contents = {};
        }
        if (parent) {
          parent.contents[name] = node;
        }
        return node;
      },node_ops:{getattr:function(node) {
          return {
            dev: 1,
            ino: undefined,
            mode: node.mode,
            nlink: 1,
            uid: 0,
            gid: 0,
            rdev: undefined,
            size: node.size,
            atime: new Date(node.timestamp),
            mtime: new Date(node.timestamp),
            ctime: new Date(node.timestamp),
            blksize: 4096,
            blocks: Math.ceil(node.size / 4096),
          };
        },setattr:function(node, attr) {
          if (attr.mode !== undefined) {
            node.mode = attr.mode;
          }
          if (attr.timestamp !== undefined) {
            node.timestamp = attr.timestamp;
          }
        },lookup:function(parent, name) {
          throw new FS.ErrnoError(2);
        },mknod:function (parent, name, mode, dev) {
          throw new FS.ErrnoError(1);
        },rename:function (oldNode, newDir, newName) {
          throw new FS.ErrnoError(1);
        },unlink:function(parent, name) {
          throw new FS.ErrnoError(1);
        },rmdir:function(parent, name) {
          throw new FS.ErrnoError(1);
        },readdir:function(node) {
          var entries = ['.', '..'];
          for (var key in node.contents) {
            if (!node.contents.hasOwnProperty(key)) {
              continue;
            }
            entries.push(key);
          }
          return entries;
        },symlink:function(parent, newName, oldPath) {
          throw new FS.ErrnoError(1);
        },readlink:function(node) {
          throw new FS.ErrnoError(1);
        }},stream_ops:{read:function (stream, buffer, offset, length, position) {
          if (position >= stream.node.size) return 0;
          var chunk = stream.node.contents.slice(position, position + length);
          var ab = WORKERFS.reader.readAsArrayBuffer(chunk);
          buffer.set(new Uint8Array(ab), offset);
          return chunk.size;
        },write:function (stream, buffer, offset, length, position) {
          throw new FS.ErrnoError(5);
        },llseek:function (stream, offset, whence) {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            if (FS.isFile(stream.node.mode)) {
              position += stream.node.size;
            }
          }
          if (position < 0) {
            throw new FS.ErrnoError(22);
          }
          return position;
        }}};
  
  var ERRNO_MESSAGES={0:"Success",1:"Not super-user",2:"No such file or directory",3:"No such process",4:"Interrupted system call",5:"I/O error",6:"No such device or address",7:"Arg list too long",8:"Exec format error",9:"Bad file number",10:"No children",11:"No more processes",12:"Not enough core",13:"Permission denied",14:"Bad address",15:"Block device required",16:"Mount device busy",17:"File exists",18:"Cross-device link",19:"No such device",20:"Not a directory",21:"Is a directory",22:"Invalid argument",23:"Too many open files in system",24:"Too many open files",25:"Not a typewriter",26:"Text file busy",27:"File too large",28:"No space left on device",29:"Illegal seek",30:"Read only file system",31:"Too many links",32:"Broken pipe",33:"Math arg out of domain of func",34:"Math result not representable",35:"File locking deadlock error",36:"File or path name too long",37:"No record locks available",38:"Function not implemented",39:"Directory not empty",40:"Too many symbolic links",42:"No message of desired type",43:"Identifier removed",44:"Channel number out of range",45:"Level 2 not synchronized",46:"Level 3 halted",47:"Level 3 reset",48:"Link number out of range",49:"Protocol driver not attached",50:"No CSI structure available",51:"Level 2 halted",52:"Invalid exchange",53:"Invalid request descriptor",54:"Exchange full",55:"No anode",56:"Invalid request code",57:"Invalid slot",59:"Bad font file fmt",60:"Device not a stream",61:"No data (for no delay io)",62:"Timer expired",63:"Out of streams resources",64:"Machine is not on the network",65:"Package not installed",66:"The object is remote",67:"The link has been severed",68:"Advertise error",69:"Srmount error",70:"Communication error on send",71:"Protocol error",72:"Multihop attempted",73:"Cross mount point (not really error)",74:"Trying to read unreadable message",75:"Value too large for defined data type",76:"Given log. name not unique",77:"f.d. invalid for this operation",78:"Remote address changed",79:"Can   access a needed shared lib",80:"Accessing a corrupted shared lib",81:".lib section in a.out corrupted",82:"Attempting to link in too many libs",83:"Attempting to exec a shared library",84:"Illegal byte sequence",86:"Streams pipe error",87:"Too many users",88:"Socket operation on non-socket",89:"Destination address required",90:"Message too long",91:"Protocol wrong type for socket",92:"Protocol not available",93:"Unknown protocol",94:"Socket type not supported",95:"Not supported",96:"Protocol family not supported",97:"Address family not supported by protocol family",98:"Address already in use",99:"Address not available",100:"Network interface is not configured",101:"Network is unreachable",102:"Connection reset by network",103:"Connection aborted",104:"Connection reset by peer",105:"No buffer space available",106:"Socket is already connected",107:"Socket is not connected",108:"Can't send after socket shutdown",109:"Too many references",110:"Connection timed out",111:"Connection refused",112:"Host is down",113:"Host is unreachable",114:"Socket already connected",115:"Connection already in progress",116:"Stale file handle",122:"Quota exceeded",123:"No medium (in tape drive)",125:"Operation canceled",130:"Previous owner died",131:"State not recoverable"};
  
  var ERRNO_CODES={EPERM:1,ENOENT:2,ESRCH:3,EINTR:4,EIO:5,ENXIO:6,E2BIG:7,ENOEXEC:8,EBADF:9,ECHILD:10,EAGAIN:11,EWOULDBLOCK:11,ENOMEM:12,EACCES:13,EFAULT:14,ENOTBLK:15,EBUSY:16,EEXIST:17,EXDEV:18,ENODEV:19,ENOTDIR:20,EISDIR:21,EINVAL:22,ENFILE:23,EMFILE:24,ENOTTY:25,ETXTBSY:26,EFBIG:27,ENOSPC:28,ESPIPE:29,EROFS:30,EMLINK:31,EPIPE:32,EDOM:33,ERANGE:34,ENOMSG:42,EIDRM:43,ECHRNG:44,EL2NSYNC:45,EL3HLT:46,EL3RST:47,ELNRNG:48,EUNATCH:49,ENOCSI:50,EL2HLT:51,EDEADLK:35,ENOLCK:37,EBADE:52,EBADR:53,EXFULL:54,ENOANO:55,EBADRQC:56,EBADSLT:57,EDEADLOCK:35,EBFONT:59,ENOSTR:60,ENODATA:61,ETIME:62,ENOSR:63,ENONET:64,ENOPKG:65,EREMOTE:66,ENOLINK:67,EADV:68,ESRMNT:69,ECOMM:70,EPROTO:71,EMULTIHOP:72,EDOTDOT:73,EBADMSG:74,ENOTUNIQ:76,EBADFD:77,EREMCHG:78,ELIBACC:79,ELIBBAD:80,ELIBSCN:81,ELIBMAX:82,ELIBEXEC:83,ENOSYS:38,ENOTEMPTY:39,ENAMETOOLONG:36,ELOOP:40,EOPNOTSUPP:95,EPFNOSUPPORT:96,ECONNRESET:104,ENOBUFS:105,EAFNOSUPPORT:97,EPROTOTYPE:91,ENOTSOCK:88,ENOPROTOOPT:92,ESHUTDOWN:108,ECONNREFUSED:111,EADDRINUSE:98,ECONNABORTED:103,ENETUNREACH:101,ENETDOWN:100,ETIMEDOUT:110,EHOSTDOWN:112,EHOSTUNREACH:113,EINPROGRESS:115,EALREADY:114,EDESTADDRREQ:89,EMSGSIZE:90,EPROTONOSUPPORT:93,ESOCKTNOSUPPORT:94,EADDRNOTAVAIL:99,ENETRESET:102,EISCONN:106,ENOTCONN:107,ETOOMANYREFS:109,EUSERS:87,EDQUOT:122,ESTALE:116,ENOTSUP:95,ENOMEDIUM:123,EILSEQ:84,EOVERFLOW:75,ECANCELED:125,ENOTRECOVERABLE:131,EOWNERDEAD:130,ESTRPIPE:86};var FS={root:null,mounts:[],devices:{},streams:[],nextInode:1,nameTable:null,currentPath:"/",initialized:false,ignorePermissions:true,trackingDelegate:{},tracking:{openFlags:{READ:1,WRITE:2}},ErrnoError:null,genericErrors:{},filesystems:null,syncFSRequests:0,handleFSError:function(e) {
        if (!(e instanceof FS.ErrnoError)) throw e + ' : ' + stackTrace();
        return ___setErrNo(e.errno);
      },lookupPath:function(path, opts) {
        path = PATH.resolve(FS.cwd(), path);
        opts = opts || {};
  
        if (!path) return { path: '', node: null };
  
        var defaults = {
          follow_mount: true,
          recurse_count: 0
        };
        for (var key in defaults) {
          if (opts[key] === undefined) {
            opts[key] = defaults[key];
          }
        }
  
        if (opts.recurse_count > 8) {  // max recursive lookup of 8
          throw new FS.ErrnoError(40);
        }
  
        // split the path
        var parts = PATH.normalizeArray(path.split('/').filter(function(p) {
          return !!p;
        }), false);
  
        // start at the root
        var current = FS.root;
        var current_path = '/';
  
        for (var i = 0; i < parts.length; i++) {
          var islast = (i === parts.length-1);
          if (islast && opts.parent) {
            // stop resolving
            break;
          }
  
          current = FS.lookupNode(current, parts[i]);
          current_path = PATH.join2(current_path, parts[i]);
  
          // jump to the mount's root node if this is a mountpoint
          if (FS.isMountpoint(current)) {
            if (!islast || (islast && opts.follow_mount)) {
              current = current.mounted.root;
            }
          }
  
          // by default, lookupPath will not follow a symlink if it is the final path component.
          // setting opts.follow = true will override this behavior.
          if (!islast || opts.follow) {
            var count = 0;
            while (FS.isLink(current.mode)) {
              var link = FS.readlink(current_path);
              current_path = PATH.resolve(PATH.dirname(current_path), link);
  
              var lookup = FS.lookupPath(current_path, { recurse_count: opts.recurse_count });
              current = lookup.node;
  
              if (count++ > 40) {  // limit max consecutive symlinks to 40 (SYMLOOP_MAX).
                throw new FS.ErrnoError(40);
              }
            }
          }
        }
  
        return { path: current_path, node: current };
      },getPath:function(node) {
        var path;
        while (true) {
          if (FS.isRoot(node)) {
            var mount = node.mount.mountpoint;
            if (!path) return mount;
            return mount[mount.length-1] !== '/' ? mount + '/' + path : mount + path;
          }
          path = path ? node.name + '/' + path : node.name;
          node = node.parent;
        }
      },hashName:function(parentid, name) {
        var hash = 0;
  
  
        for (var i = 0; i < name.length; i++) {
          hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
        }
        return ((parentid + hash) >>> 0) % FS.nameTable.length;
      },hashAddNode:function(node) {
        var hash = FS.hashName(node.parent.id, node.name);
        node.name_next = FS.nameTable[hash];
        FS.nameTable[hash] = node;
      },hashRemoveNode:function(node) {
        var hash = FS.hashName(node.parent.id, node.name);
        if (FS.nameTable[hash] === node) {
          FS.nameTable[hash] = node.name_next;
        } else {
          var current = FS.nameTable[hash];
          while (current) {
            if (current.name_next === node) {
              current.name_next = node.name_next;
              break;
            }
            current = current.name_next;
          }
        }
      },lookupNode:function(parent, name) {
        var err = FS.mayLookup(parent);
        if (err) {
          throw new FS.ErrnoError(err, parent);
        }
        var hash = FS.hashName(parent.id, name);
        for (var node = FS.nameTable[hash]; node; node = node.name_next) {
          var nodeName = node.name;
          if (node.parent.id === parent.id && nodeName === name) {
            return node;
          }
        }
        // if we failed to find it in the cache, call into the VFS
        return FS.lookup(parent, name);
      },createNode:function(parent, name, mode, rdev) {
        if (!FS.FSNode) {
          FS.FSNode = function(parent, name, mode, rdev) {
            if (!parent) {
              parent = this;  // root node sets parent to itself
            }
            this.parent = parent;
            this.mount = parent.mount;
            this.mounted = null;
            this.id = FS.nextInode++;
            this.name = name;
            this.mode = mode;
            this.node_ops = {};
            this.stream_ops = {};
            this.rdev = rdev;
          };
  
          FS.FSNode.prototype = {};
  
          // compatibility
          var readMode = 292 | 73;
          var writeMode = 146;
  
          // NOTE we must use Object.defineProperties instead of individual calls to
          // Object.defineProperty in order to make closure compiler happy
          Object.defineProperties(FS.FSNode.prototype, {
            read: {
              get: function() { return (this.mode & readMode) === readMode; },
              set: function(val) { val ? this.mode |= readMode : this.mode &= ~readMode; }
            },
            write: {
              get: function() { return (this.mode & writeMode) === writeMode; },
              set: function(val) { val ? this.mode |= writeMode : this.mode &= ~writeMode; }
            },
            isFolder: {
              get: function() { return FS.isDir(this.mode); }
            },
            isDevice: {
              get: function() { return FS.isChrdev(this.mode); }
            }
          });
        }
  
        var node = new FS.FSNode(parent, name, mode, rdev);
  
        FS.hashAddNode(node);
  
        return node;
      },destroyNode:function(node) {
        FS.hashRemoveNode(node);
      },isRoot:function(node) {
        return node === node.parent;
      },isMountpoint:function(node) {
        return !!node.mounted;
      },isFile:function(mode) {
        return (mode & 61440) === 32768;
      },isDir:function(mode) {
        return (mode & 61440) === 16384;
      },isLink:function(mode) {
        return (mode & 61440) === 40960;
      },isChrdev:function(mode) {
        return (mode & 61440) === 8192;
      },isBlkdev:function(mode) {
        return (mode & 61440) === 24576;
      },isFIFO:function(mode) {
        return (mode & 61440) === 4096;
      },isSocket:function(mode) {
        return (mode & 49152) === 49152;
      },flagModes:{"r":0,"rs":1052672,"r+":2,"w":577,"wx":705,"xw":705,"w+":578,"wx+":706,"xw+":706,"a":1089,"ax":1217,"xa":1217,"a+":1090,"ax+":1218,"xa+":1218},modeStringToFlags:function(str) {
        var flags = FS.flagModes[str];
        if (typeof flags === 'undefined') {
          throw new Error('Unknown file open mode: ' + str);
        }
        return flags;
      },flagsToPermissionString:function(flag) {
        var perms = ['r', 'w', 'rw'][flag & 3];
        if ((flag & 512)) {
          perms += 'w';
        }
        return perms;
      },nodePermissions:function(node, perms) {
        if (FS.ignorePermissions) {
          return 0;
        }
        // return 0 if any user, group or owner bits are set.
        if (perms.indexOf('r') !== -1 && !(node.mode & 292)) {
          return 13;
        } else if (perms.indexOf('w') !== -1 && !(node.mode & 146)) {
          return 13;
        } else if (perms.indexOf('x') !== -1 && !(node.mode & 73)) {
          return 13;
        }
        return 0;
      },mayLookup:function(dir) {
        var err = FS.nodePermissions(dir, 'x');
        if (err) return err;
        if (!dir.node_ops.lookup) return 13;
        return 0;
      },mayCreate:function(dir, name) {
        try {
          var node = FS.lookupNode(dir, name);
          return 17;
        } catch (e) {
        }
        return FS.nodePermissions(dir, 'wx');
      },mayDelete:function(dir, name, isdir) {
        var node;
        try {
          node = FS.lookupNode(dir, name);
        } catch (e) {
          return e.errno;
        }
        var err = FS.nodePermissions(dir, 'wx');
        if (err) {
          return err;
        }
        if (isdir) {
          if (!FS.isDir(node.mode)) {
            return 20;
          }
          if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
            return 16;
          }
        } else {
          if (FS.isDir(node.mode)) {
            return 21;
          }
        }
        return 0;
      },mayOpen:function(node, flags) {
        if (!node) {
          return 2;
        }
        if (FS.isLink(node.mode)) {
          return 40;
        } else if (FS.isDir(node.mode)) {
          if (FS.flagsToPermissionString(flags) !== 'r' || // opening for write
              (flags & 512)) { // TODO: check for O_SEARCH? (== search for dir only)
            return 21;
          }
        }
        return FS.nodePermissions(node, FS.flagsToPermissionString(flags));
      },MAX_OPEN_FDS:4096,nextfd:function(fd_start, fd_end) {
        fd_start = fd_start || 0;
        fd_end = fd_end || FS.MAX_OPEN_FDS;
        for (var fd = fd_start; fd <= fd_end; fd++) {
          if (!FS.streams[fd]) {
            return fd;
          }
        }
        throw new FS.ErrnoError(24);
      },getStream:function(fd) {
        return FS.streams[fd];
      },createStream:function(stream, fd_start, fd_end) {
        if (!FS.FSStream) {
          FS.FSStream = function(){};
          FS.FSStream.prototype = {};
          // compatibility
          Object.defineProperties(FS.FSStream.prototype, {
            object: {
              get: function() { return this.node; },
              set: function(val) { this.node = val; }
            },
            isRead: {
              get: function() { return (this.flags & 2097155) !== 1; }
            },
            isWrite: {
              get: function() { return (this.flags & 2097155) !== 0; }
            },
            isAppend: {
              get: function() { return (this.flags & 1024); }
            }
          });
        }
        // clone it, so we can return an instance of FSStream
        var newStream = new FS.FSStream();
        for (var p in stream) {
          newStream[p] = stream[p];
        }
        stream = newStream;
        var fd = FS.nextfd(fd_start, fd_end);
        stream.fd = fd;
        FS.streams[fd] = stream;
        return stream;
      },closeStream:function(fd) {
        FS.streams[fd] = null;
      },chrdev_stream_ops:{open:function(stream) {
          var device = FS.getDevice(stream.node.rdev);
          // override node's stream ops with the device's
          stream.stream_ops = device.stream_ops;
          // forward the open call
          if (stream.stream_ops.open) {
            stream.stream_ops.open(stream);
          }
        },llseek:function() {
          throw new FS.ErrnoError(29);
        }},major:function(dev) {
        return ((dev) >> 8);
      },minor:function(dev) {
        return ((dev) & 0xff);
      },makedev:function(ma, mi) {
        return ((ma) << 8 | (mi));
      },registerDevice:function(dev, ops) {
        FS.devices[dev] = { stream_ops: ops };
      },getDevice:function(dev) {
        return FS.devices[dev];
      },getMounts:function(mount) {
        var mounts = [];
        var check = [mount];
  
        while (check.length) {
          var m = check.pop();
  
          mounts.push(m);
  
          check.push.apply(check, m.mounts);
        }
  
        return mounts;
      },syncfs:function(populate, callback) {
        if (typeof(populate) === 'function') {
          callback = populate;
          populate = false;
        }
  
        FS.syncFSRequests++;
  
        if (FS.syncFSRequests > 1) {
          console.log('warning: ' + FS.syncFSRequests + ' FS.syncfs operations in flight at once, probably just doing extra work');
        }
  
        var mounts = FS.getMounts(FS.root.mount);
        var completed = 0;
  
        function doCallback(err) {
          assert(FS.syncFSRequests > 0);
          FS.syncFSRequests--;
          return callback(err);
        }
  
        function done(err) {
          if (err) {
            if (!done.errored) {
              done.errored = true;
              return doCallback(err);
            }
            return;
          }
          if (++completed >= mounts.length) {
            doCallback(null);
          }
        };
  
        // sync all mounts
        mounts.forEach(function (mount) {
          if (!mount.type.syncfs) {
            return done(null);
          }
          mount.type.syncfs(mount, populate, done);
        });
      },mount:function(type, opts, mountpoint) {
        var root = mountpoint === '/';
        var pseudo = !mountpoint;
        var node;
  
        if (root && FS.root) {
          throw new FS.ErrnoError(16);
        } else if (!root && !pseudo) {
          var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
  
          mountpoint = lookup.path;  // use the absolute path
          node = lookup.node;
  
          if (FS.isMountpoint(node)) {
            throw new FS.ErrnoError(16);
          }
  
          if (!FS.isDir(node.mode)) {
            throw new FS.ErrnoError(20);
          }
        }
  
        var mount = {
          type: type,
          opts: opts,
          mountpoint: mountpoint,
          mounts: []
        };
  
        // create a root node for the fs
        var mountRoot = type.mount(mount);
        mountRoot.mount = mount;
        mount.root = mountRoot;
  
        if (root) {
          FS.root = mountRoot;
        } else if (node) {
          // set as a mountpoint
          node.mounted = mount;
  
          // add the new mount to the current mount's children
          if (node.mount) {
            node.mount.mounts.push(mount);
          }
        }
  
        return mountRoot;
      },unmount:function (mountpoint) {
        var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
  
        if (!FS.isMountpoint(lookup.node)) {
          throw new FS.ErrnoError(22);
        }
  
        // destroy the nodes for this mount, and all its child mounts
        var node = lookup.node;
        var mount = node.mounted;
        var mounts = FS.getMounts(mount);
  
        Object.keys(FS.nameTable).forEach(function (hash) {
          var current = FS.nameTable[hash];
  
          while (current) {
            var next = current.name_next;
  
            if (mounts.indexOf(current.mount) !== -1) {
              FS.destroyNode(current);
            }
  
            current = next;
          }
        });
  
        // no longer a mountpoint
        node.mounted = null;
  
        // remove this mount from the child mounts
        var idx = node.mount.mounts.indexOf(mount);
        assert(idx !== -1);
        node.mount.mounts.splice(idx, 1);
      },lookup:function(parent, name) {
        return parent.node_ops.lookup(parent, name);
      },mknod:function(path, mode, dev) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        if (!name || name === '.' || name === '..') {
          throw new FS.ErrnoError(22);
        }
        var err = FS.mayCreate(parent, name);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.mknod) {
          throw new FS.ErrnoError(1);
        }
        return parent.node_ops.mknod(parent, name, mode, dev);
      },create:function(path, mode) {
        mode = mode !== undefined ? mode : 438 /* 0666 */;
        mode &= 4095;
        mode |= 32768;
        return FS.mknod(path, mode, 0);
      },mkdir:function(path, mode) {
        mode = mode !== undefined ? mode : 511 /* 0777 */;
        mode &= 511 | 512;
        mode |= 16384;
        return FS.mknod(path, mode, 0);
      },mkdirTree:function(path, mode) {
        var dirs = path.split('/');
        var d = '';
        for (var i = 0; i < dirs.length; ++i) {
          if (!dirs[i]) continue;
          d += '/' + dirs[i];
          try {
            FS.mkdir(d, mode);
          } catch(e) {
            if (e.errno != 17) throw e;
          }
        }
      },mkdev:function(path, mode, dev) {
        if (typeof(dev) === 'undefined') {
          dev = mode;
          mode = 438 /* 0666 */;
        }
        mode |= 8192;
        return FS.mknod(path, mode, dev);
      },symlink:function(oldpath, newpath) {
        if (!PATH.resolve(oldpath)) {
          throw new FS.ErrnoError(2);
        }
        var lookup = FS.lookupPath(newpath, { parent: true });
        var parent = lookup.node;
        if (!parent) {
          throw new FS.ErrnoError(2);
        }
        var newname = PATH.basename(newpath);
        var err = FS.mayCreate(parent, newname);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.symlink) {
          throw new FS.ErrnoError(1);
        }
        return parent.node_ops.symlink(parent, newname, oldpath);
      },rename:function(old_path, new_path) {
        var old_dirname = PATH.dirname(old_path);
        var new_dirname = PATH.dirname(new_path);
        var old_name = PATH.basename(old_path);
        var new_name = PATH.basename(new_path);
        // parents must exist
        var lookup, old_dir, new_dir;
        try {
          lookup = FS.lookupPath(old_path, { parent: true });
          old_dir = lookup.node;
          lookup = FS.lookupPath(new_path, { parent: true });
          new_dir = lookup.node;
        } catch (e) {
          throw new FS.ErrnoError(16);
        }
        if (!old_dir || !new_dir) throw new FS.ErrnoError(2);
        // need to be part of the same mount
        if (old_dir.mount !== new_dir.mount) {
          throw new FS.ErrnoError(18);
        }
        // source must exist
        var old_node = FS.lookupNode(old_dir, old_name);
        // old path should not be an ancestor of the new path
        var relative = PATH.relative(old_path, new_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(22);
        }
        // new path should not be an ancestor of the old path
        relative = PATH.relative(new_path, old_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(39);
        }
        // see if the new path already exists
        var new_node;
        try {
          new_node = FS.lookupNode(new_dir, new_name);
        } catch (e) {
          // not fatal
        }
        // early out if nothing needs to change
        if (old_node === new_node) {
          return;
        }
        // we'll need to delete the old entry
        var isdir = FS.isDir(old_node.mode);
        var err = FS.mayDelete(old_dir, old_name, isdir);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        // need delete permissions if we'll be overwriting.
        // need create permissions if new doesn't already exist.
        err = new_node ?
          FS.mayDelete(new_dir, new_name, isdir) :
          FS.mayCreate(new_dir, new_name);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!old_dir.node_ops.rename) {
          throw new FS.ErrnoError(1);
        }
        if (FS.isMountpoint(old_node) || (new_node && FS.isMountpoint(new_node))) {
          throw new FS.ErrnoError(16);
        }
        // if we are going to change the parent, check write permissions
        if (new_dir !== old_dir) {
          err = FS.nodePermissions(old_dir, 'w');
          if (err) {
            throw new FS.ErrnoError(err);
          }
        }
        try {
          if (FS.trackingDelegate['willMovePath']) {
            FS.trackingDelegate['willMovePath'](old_path, new_path);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['willMovePath']('"+old_path+"', '"+new_path+"') threw an exception: " + e.message);
        }
        // remove the node from the lookup hash
        FS.hashRemoveNode(old_node);
        // do the underlying fs rename
        try {
          old_dir.node_ops.rename(old_node, new_dir, new_name);
        } catch (e) {
          throw e;
        } finally {
          // add the node back to the hash (in case node_ops.rename
          // changed its name)
          FS.hashAddNode(old_node);
        }
        try {
          if (FS.trackingDelegate['onMovePath']) FS.trackingDelegate['onMovePath'](old_path, new_path);
        } catch(e) {
          console.log("FS.trackingDelegate['onMovePath']('"+old_path+"', '"+new_path+"') threw an exception: " + e.message);
        }
      },rmdir:function(path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var err = FS.mayDelete(parent, name, true);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.rmdir) {
          throw new FS.ErrnoError(1);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(16);
        }
        try {
          if (FS.trackingDelegate['willDeletePath']) {
            FS.trackingDelegate['willDeletePath'](path);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['willDeletePath']('"+path+"') threw an exception: " + e.message);
        }
        parent.node_ops.rmdir(parent, name);
        FS.destroyNode(node);
        try {
          if (FS.trackingDelegate['onDeletePath']) FS.trackingDelegate['onDeletePath'](path);
        } catch(e) {
          console.log("FS.trackingDelegate['onDeletePath']('"+path+"') threw an exception: " + e.message);
        }
      },readdir:function(path) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        if (!node.node_ops.readdir) {
          throw new FS.ErrnoError(20);
        }
        return node.node_ops.readdir(node);
      },unlink:function(path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var err = FS.mayDelete(parent, name, false);
        if (err) {
          // According to POSIX, we should map EISDIR to EPERM, but
          // we instead do what Linux does (and we must, as we use
          // the musl linux libc).
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.unlink) {
          throw new FS.ErrnoError(1);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(16);
        }
        try {
          if (FS.trackingDelegate['willDeletePath']) {
            FS.trackingDelegate['willDeletePath'](path);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['willDeletePath']('"+path+"') threw an exception: " + e.message);
        }
        parent.node_ops.unlink(parent, name);
        FS.destroyNode(node);
        try {
          if (FS.trackingDelegate['onDeletePath']) FS.trackingDelegate['onDeletePath'](path);
        } catch(e) {
          console.log("FS.trackingDelegate['onDeletePath']('"+path+"') threw an exception: " + e.message);
        }
      },readlink:function(path) {
        var lookup = FS.lookupPath(path);
        var link = lookup.node;
        if (!link) {
          throw new FS.ErrnoError(2);
        }
        if (!link.node_ops.readlink) {
          throw new FS.ErrnoError(22);
        }
        return PATH.resolve(FS.getPath(link.parent), link.node_ops.readlink(link));
      },stat:function(path, dontFollow) {
        var lookup = FS.lookupPath(path, { follow: !dontFollow });
        var node = lookup.node;
        if (!node) {
          throw new FS.ErrnoError(2);
        }
        if (!node.node_ops.getattr) {
          throw new FS.ErrnoError(1);
        }
        return node.node_ops.getattr(node);
      },lstat:function(path) {
        return FS.stat(path, true);
      },chmod:function(path, mode, dontFollow) {
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(1);
        }
        node.node_ops.setattr(node, {
          mode: (mode & 4095) | (node.mode & ~4095),
          timestamp: Date.now()
        });
      },lchmod:function(path, mode) {
        FS.chmod(path, mode, true);
      },fchmod:function(fd, mode) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(9);
        }
        FS.chmod(stream.node, mode);
      },chown:function(path, uid, gid, dontFollow) {
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(1);
        }
        node.node_ops.setattr(node, {
          timestamp: Date.now()
          // we ignore the uid / gid for now
        });
      },lchown:function(path, uid, gid) {
        FS.chown(path, uid, gid, true);
      },fchown:function(fd, uid, gid) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(9);
        }
        FS.chown(stream.node, uid, gid);
      },truncate:function(path, len) {
        if (len < 0) {
          throw new FS.ErrnoError(22);
        }
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: true });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(1);
        }
        if (FS.isDir(node.mode)) {
          throw new FS.ErrnoError(21);
        }
        if (!FS.isFile(node.mode)) {
          throw new FS.ErrnoError(22);
        }
        var err = FS.nodePermissions(node, 'w');
        if (err) {
          throw new FS.ErrnoError(err);
        }
        node.node_ops.setattr(node, {
          size: len,
          timestamp: Date.now()
        });
      },ftruncate:function(fd, len) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(9);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(22);
        }
        FS.truncate(stream.node, len);
      },utime:function(path, atime, mtime) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        node.node_ops.setattr(node, {
          timestamp: Math.max(atime, mtime)
        });
      },open:function(path, flags, mode, fd_start, fd_end) {
        if (path === "") {
          throw new FS.ErrnoError(2);
        }
        flags = typeof flags === 'string' ? FS.modeStringToFlags(flags) : flags;
        mode = typeof mode === 'undefined' ? 438 /* 0666 */ : mode;
        if ((flags & 64)) {
          mode = (mode & 4095) | 32768;
        } else {
          mode = 0;
        }
        var node;
        if (typeof path === 'object') {
          node = path;
        } else {
          path = PATH.normalize(path);
          try {
            var lookup = FS.lookupPath(path, {
              follow: !(flags & 131072)
            });
            node = lookup.node;
          } catch (e) {
            // ignore
          }
        }
        // perhaps we need to create the node
        var created = false;
        if ((flags & 64)) {
          if (node) {
            // if O_CREAT and O_EXCL are set, error out if the node already exists
            if ((flags & 128)) {
              throw new FS.ErrnoError(17);
            }
          } else {
            // node doesn't exist, try to create it
            node = FS.mknod(path, mode, 0);
            created = true;
          }
        }
        if (!node) {
          throw new FS.ErrnoError(2);
        }
        // can't truncate a device
        if (FS.isChrdev(node.mode)) {
          flags &= ~512;
        }
        // if asked only for a directory, then this must be one
        if ((flags & 65536) && !FS.isDir(node.mode)) {
          throw new FS.ErrnoError(20);
        }
        // check permissions, if this is not a file we just created now (it is ok to
        // create and write to a file with read-only permissions; it is read-only
        // for later use)
        if (!created) {
          var err = FS.mayOpen(node, flags);
          if (err) {
            throw new FS.ErrnoError(err);
          }
        }
        // do truncation if necessary
        if ((flags & 512)) {
          FS.truncate(node, 0);
        }
        // we've already handled these, don't pass down to the underlying vfs
        flags &= ~(128 | 512);
  
        // register the stream with the filesystem
        var stream = FS.createStream({
          node: node,
          path: FS.getPath(node),  // we want the absolute path to the node
          flags: flags,
          seekable: true,
          position: 0,
          stream_ops: node.stream_ops,
          // used by the file family libc calls (fopen, fwrite, ferror, etc.)
          ungotten: [],
          error: false
        }, fd_start, fd_end);
        // call the new stream's open function
        if (stream.stream_ops.open) {
          stream.stream_ops.open(stream);
        }
        if (Module['logReadFiles'] && !(flags & 1)) {
          if (!FS.readFiles) FS.readFiles = {};
          if (!(path in FS.readFiles)) {
            FS.readFiles[path] = 1;
            console.log("FS.trackingDelegate error on read file: " + path);
          }
        }
        try {
          if (FS.trackingDelegate['onOpenFile']) {
            var trackingFlags = 0;
            if ((flags & 2097155) !== 1) {
              trackingFlags |= FS.tracking.openFlags.READ;
            }
            if ((flags & 2097155) !== 0) {
              trackingFlags |= FS.tracking.openFlags.WRITE;
            }
            FS.trackingDelegate['onOpenFile'](path, trackingFlags);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['onOpenFile']('"+path+"', flags) threw an exception: " + e.message);
        }
        return stream;
      },close:function(stream) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(9);
        }
        if (stream.getdents) stream.getdents = null; // free readdir state
        try {
          if (stream.stream_ops.close) {
            stream.stream_ops.close(stream);
          }
        } catch (e) {
          throw e;
        } finally {
          FS.closeStream(stream.fd);
        }
        stream.fd = null;
      },isClosed:function(stream) {
        return stream.fd === null;
      },llseek:function(stream, offset, whence) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(9);
        }
        if (!stream.seekable || !stream.stream_ops.llseek) {
          throw new FS.ErrnoError(29);
        }
        if (whence != 0 /* SEEK_SET */ && whence != 1 /* SEEK_CUR */ && whence != 2 /* SEEK_END */) {
          throw new FS.ErrnoError(22);
        }
        stream.position = stream.stream_ops.llseek(stream, offset, whence);
        stream.ungotten = [];
        return stream.position;
      },read:function(stream, buffer, offset, length, position) {
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(22);
        }
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(9);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(9);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(21);
        }
        if (!stream.stream_ops.read) {
          throw new FS.ErrnoError(22);
        }
        var seeking = typeof position !== 'undefined';
        if (!seeking) {
          position = stream.position;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(29);
        }
        var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
        if (!seeking) stream.position += bytesRead;
        return bytesRead;
      },write:function(stream, buffer, offset, length, position, canOwn) {
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(22);
        }
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(9);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(9);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(21);
        }
        if (!stream.stream_ops.write) {
          throw new FS.ErrnoError(22);
        }
        if (stream.flags & 1024) {
          // seek to the end before writing in append mode
          FS.llseek(stream, 0, 2);
        }
        var seeking = typeof position !== 'undefined';
        if (!seeking) {
          position = stream.position;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(29);
        }
        var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
        if (!seeking) stream.position += bytesWritten;
        try {
          if (stream.path && FS.trackingDelegate['onWriteToFile']) FS.trackingDelegate['onWriteToFile'](stream.path);
        } catch(e) {
          console.log("FS.trackingDelegate['onWriteToFile']('"+stream.path+"') threw an exception: " + e.message);
        }
        return bytesWritten;
      },allocate:function(stream, offset, length) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(9);
        }
        if (offset < 0 || length <= 0) {
          throw new FS.ErrnoError(22);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(9);
        }
        if (!FS.isFile(stream.node.mode) && !FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(19);
        }
        if (!stream.stream_ops.allocate) {
          throw new FS.ErrnoError(95);
        }
        stream.stream_ops.allocate(stream, offset, length);
      },mmap:function(stream, buffer, offset, length, position, prot, flags) {
        // TODO if PROT is PROT_WRITE, make sure we have write access
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(13);
        }
        if (!stream.stream_ops.mmap) {
          throw new FS.ErrnoError(19);
        }
        return stream.stream_ops.mmap(stream, buffer, offset, length, position, prot, flags);
      },msync:function(stream, buffer, offset, length, mmapFlags) {
        if (!stream || !stream.stream_ops.msync) {
          return 0;
        }
        return stream.stream_ops.msync(stream, buffer, offset, length, mmapFlags);
      },munmap:function(stream) {
        return 0;
      },ioctl:function(stream, cmd, arg) {
        if (!stream.stream_ops.ioctl) {
          throw new FS.ErrnoError(25);
        }
        return stream.stream_ops.ioctl(stream, cmd, arg);
      },readFile:function(path, opts) {
        opts = opts || {};
        opts.flags = opts.flags || 'r';
        opts.encoding = opts.encoding || 'binary';
        if (opts.encoding !== 'utf8' && opts.encoding !== 'binary') {
          throw new Error('Invalid encoding type "' + opts.encoding + '"');
        }
        var ret;
        var stream = FS.open(path, opts.flags);
        var stat = FS.stat(path);
        var length = stat.size;
        var buf = new Uint8Array(length);
        FS.read(stream, buf, 0, length, 0);
        if (opts.encoding === 'utf8') {
          ret = UTF8ArrayToString(buf, 0);
        } else if (opts.encoding === 'binary') {
          ret = buf;
        }
        FS.close(stream);
        return ret;
      },writeFile:function(path, data, opts) {
        opts = opts || {};
        opts.flags = opts.flags || 'w';
        var stream = FS.open(path, opts.flags, opts.mode);
        if (typeof data === 'string') {
          var buf = new Uint8Array(lengthBytesUTF8(data)+1);
          var actualNumBytes = stringToUTF8Array(data, buf, 0, buf.length);
          FS.write(stream, buf, 0, actualNumBytes, undefined, opts.canOwn);
        } else if (ArrayBuffer.isView(data)) {
          FS.write(stream, data, 0, data.byteLength, undefined, opts.canOwn);
        } else {
          throw new Error('Unsupported data type');
        }
        FS.close(stream);
      },cwd:function() {
        return FS.currentPath;
      },chdir:function(path) {
        var lookup = FS.lookupPath(path, { follow: true });
        if (lookup.node === null) {
          throw new FS.ErrnoError(2);
        }
        if (!FS.isDir(lookup.node.mode)) {
          throw new FS.ErrnoError(20);
        }
        var err = FS.nodePermissions(lookup.node, 'x');
        if (err) {
          throw new FS.ErrnoError(err);
        }
        FS.currentPath = lookup.path;
      },createDefaultDirectories:function() {
        FS.mkdir('/tmp');
        FS.mkdir('/home');
        FS.mkdir('/home/web_user');
      },createDefaultDevices:function() {
        // create /dev
        FS.mkdir('/dev');
        // setup /dev/null
        FS.registerDevice(FS.makedev(1, 3), {
          read: function() { return 0; },
          write: function(stream, buffer, offset, length, pos) { return length; }
        });
        FS.mkdev('/dev/null', FS.makedev(1, 3));
        // setup /dev/tty and /dev/tty1
        // stderr needs to print output using Module['printErr']
        // so we register a second tty just for it.
        TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
        TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
        FS.mkdev('/dev/tty', FS.makedev(5, 0));
        FS.mkdev('/dev/tty1', FS.makedev(6, 0));
        // setup /dev/[u]random
        var random_device;
        if (typeof crypto === 'object' && typeof crypto['getRandomValues'] === 'function') {
          // for modern web browsers
          var randomBuffer = new Uint8Array(1);
          random_device = function() { crypto.getRandomValues(randomBuffer); return randomBuffer[0]; };
        } else
        if (ENVIRONMENT_IS_NODE) {
          // for nodejs with or without crypto support included
          try {
            var crypto_module = require('crypto');
            // nodejs has crypto support
            random_device = function() { return crypto_module['randomBytes'](1)[0]; };
          } catch (e) {
            // nodejs doesn't have crypto support
          }
        } else
        {}
        if (!random_device) {
          // we couldn't find a proper implementation, as Math.random() is not suitable for /dev/random, see emscripten-core/emscripten/pull/7096
          random_device = function() { abort("no cryptographic support found for random_device. consider polyfilling it if you want to use something insecure like Math.random(), e.g. put this in a --pre-js: var crypto = { getRandomValues: function(array) { for (var i = 0; i < array.length; i++) array[i] = (Math.random()*256)|0 } };"); };
        }
        FS.createDevice('/dev', 'random', random_device);
        FS.createDevice('/dev', 'urandom', random_device);
        // we're not going to emulate the actual shm device,
        // just create the tmp dirs that reside in it commonly
        FS.mkdir('/dev/shm');
        FS.mkdir('/dev/shm/tmp');
      },createSpecialDirectories:function() {
        // create /proc/self/fd which allows /proc/self/fd/6 => readlink gives the name of the stream for fd 6 (see test_unistd_ttyname)
        FS.mkdir('/proc');
        FS.mkdir('/proc/self');
        FS.mkdir('/proc/self/fd');
        FS.mount({
          mount: function() {
            var node = FS.createNode('/proc/self', 'fd', 16384 | 511 /* 0777 */, 73);
            node.node_ops = {
              lookup: function(parent, name) {
                var fd = +name;
                var stream = FS.getStream(fd);
                if (!stream) throw new FS.ErrnoError(9);
                var ret = {
                  parent: null,
                  mount: { mountpoint: 'fake' },
                  node_ops: { readlink: function() { return stream.path } }
                };
                ret.parent = ret; // make it look like a simple root node
                return ret;
              }
            };
            return node;
          }
        }, {}, '/proc/self/fd');
      },createStandardStreams:function() {
        // TODO deprecate the old functionality of a single
        // input / output callback and that utilizes FS.createDevice
        // and instead require a unique set of stream ops
  
        // by default, we symlink the standard streams to the
        // default tty devices. however, if the standard streams
        // have been overwritten we create a unique device for
        // them instead.
        if (Module['stdin']) {
          FS.createDevice('/dev', 'stdin', Module['stdin']);
        } else {
          FS.symlink('/dev/tty', '/dev/stdin');
        }
        if (Module['stdout']) {
          FS.createDevice('/dev', 'stdout', null, Module['stdout']);
        } else {
          FS.symlink('/dev/tty', '/dev/stdout');
        }
        if (Module['stderr']) {
          FS.createDevice('/dev', 'stderr', null, Module['stderr']);
        } else {
          FS.symlink('/dev/tty1', '/dev/stderr');
        }
  
        // open default streams for the stdin, stdout and stderr devices
        var stdin = FS.open('/dev/stdin', 'r');
        var stdout = FS.open('/dev/stdout', 'w');
        var stderr = FS.open('/dev/stderr', 'w');
        assert(stdin.fd === 0, 'invalid handle for stdin (' + stdin.fd + ')');
        assert(stdout.fd === 1, 'invalid handle for stdout (' + stdout.fd + ')');
        assert(stderr.fd === 2, 'invalid handle for stderr (' + stderr.fd + ')');
      },ensureErrnoError:function() {
        if (FS.ErrnoError) return;
        FS.ErrnoError = function ErrnoError(errno, node) {
          this.node = node;
          this.setErrno = function(errno) {
            this.errno = errno;
            for (var key in ERRNO_CODES) {
              if (ERRNO_CODES[key] === errno) {
                this.code = key;
                break;
              }
            }
          };
          this.setErrno(errno);
          this.message = ERRNO_MESSAGES[errno];
          // Node.js compatibility: assigning on this.stack fails on Node 4 (but fixed on Node 8)
          if (this.stack) Object.defineProperty(this, "stack", { value: (new Error).stack, writable: true });
          if (this.stack) this.stack = demangleAll(this.stack);
        };
        FS.ErrnoError.prototype = new Error();
        FS.ErrnoError.prototype.constructor = FS.ErrnoError;
        // Some errors may happen quite a bit, to avoid overhead we reuse them (and suffer a lack of stack info)
        [2].forEach(function(code) {
          FS.genericErrors[code] = new FS.ErrnoError(code);
          FS.genericErrors[code].stack = '<generic error, no stack>';
        });
      },staticInit:function() {
        FS.ensureErrnoError();
  
        FS.nameTable = new Array(4096);
  
        FS.mount(MEMFS, {}, '/');
  
        FS.createDefaultDirectories();
        FS.createDefaultDevices();
        FS.createSpecialDirectories();
  
        FS.filesystems = {
          'MEMFS': MEMFS,
          'IDBFS': IDBFS,
          'NODEFS': NODEFS,
          'WORKERFS': WORKERFS,
        };
      },init:function(input, output, error) {
        assert(!FS.init.initialized, 'FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)');
        FS.init.initialized = true;
  
        FS.ensureErrnoError();
  
        // Allow Module.stdin etc. to provide defaults, if none explicitly passed to us here
        Module['stdin'] = input || Module['stdin'];
        Module['stdout'] = output || Module['stdout'];
        Module['stderr'] = error || Module['stderr'];
  
        FS.createStandardStreams();
      },quit:function() {
        FS.init.initialized = false;
        // force-flush all streams, so we get musl std streams printed out
        var fflush = Module['_fflush'];
        if (fflush) fflush(0);
        // close all of our streams
        for (var i = 0; i < FS.streams.length; i++) {
          var stream = FS.streams[i];
          if (!stream) {
            continue;
          }
          FS.close(stream);
        }
      },getMode:function(canRead, canWrite) {
        var mode = 0;
        if (canRead) mode |= 292 | 73;
        if (canWrite) mode |= 146;
        return mode;
      },joinPath:function(parts, forceRelative) {
        var path = PATH.join.apply(null, parts);
        if (forceRelative && path[0] == '/') path = path.substr(1);
        return path;
      },absolutePath:function(relative, base) {
        return PATH.resolve(base, relative);
      },standardizePath:function(path) {
        return PATH.normalize(path);
      },findObject:function(path, dontResolveLastLink) {
        var ret = FS.analyzePath(path, dontResolveLastLink);
        if (ret.exists) {
          return ret.object;
        } else {
          ___setErrNo(ret.error);
          return null;
        }
      },analyzePath:function(path, dontResolveLastLink) {
        // operate from within the context of the symlink's target
        try {
          var lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          path = lookup.path;
        } catch (e) {
        }
        var ret = {
          isRoot: false, exists: false, error: 0, name: null, path: null, object: null,
          parentExists: false, parentPath: null, parentObject: null
        };
        try {
          var lookup = FS.lookupPath(path, { parent: true });
          ret.parentExists = true;
          ret.parentPath = lookup.path;
          ret.parentObject = lookup.node;
          ret.name = PATH.basename(path);
          lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          ret.exists = true;
          ret.path = lookup.path;
          ret.object = lookup.node;
          ret.name = lookup.node.name;
          ret.isRoot = lookup.path === '/';
        } catch (e) {
          ret.error = e.errno;
        };
        return ret;
      },createFolder:function(parent, name, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(canRead, canWrite);
        return FS.mkdir(path, mode);
      },createPath:function(parent, path, canRead, canWrite) {
        parent = typeof parent === 'string' ? parent : FS.getPath(parent);
        var parts = path.split('/').reverse();
        while (parts.length) {
          var part = parts.pop();
          if (!part) continue;
          var current = PATH.join2(parent, part);
          try {
            FS.mkdir(current);
          } catch (e) {
            // ignore EEXIST
          }
          parent = current;
        }
        return current;
      },createFile:function(parent, name, properties, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(canRead, canWrite);
        return FS.create(path, mode);
      },createDataFile:function(parent, name, data, canRead, canWrite, canOwn) {
        var path = name ? PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name) : parent;
        var mode = FS.getMode(canRead, canWrite);
        var node = FS.create(path, mode);
        if (data) {
          if (typeof data === 'string') {
            var arr = new Array(data.length);
            for (var i = 0, len = data.length; i < len; ++i) arr[i] = data.charCodeAt(i);
            data = arr;
          }
          // make sure we can write to the file
          FS.chmod(node, mode | 146);
          var stream = FS.open(node, 'w');
          FS.write(stream, data, 0, data.length, 0, canOwn);
          FS.close(stream);
          FS.chmod(node, mode);
        }
        return node;
      },createDevice:function(parent, name, input, output) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(!!input, !!output);
        if (!FS.createDevice.major) FS.createDevice.major = 64;
        var dev = FS.makedev(FS.createDevice.major++, 0);
        // Create a fake device that a set of stream ops to emulate
        // the old behavior.
        FS.registerDevice(dev, {
          open: function(stream) {
            stream.seekable = false;
          },
          close: function(stream) {
            // flush any pending line data
            if (output && output.buffer && output.buffer.length) {
              output(10);
            }
          },
          read: function(stream, buffer, offset, length, pos /* ignored */) {
            var bytesRead = 0;
            for (var i = 0; i < length; i++) {
              var result;
              try {
                result = input();
              } catch (e) {
                throw new FS.ErrnoError(5);
              }
              if (result === undefined && bytesRead === 0) {
                throw new FS.ErrnoError(11);
              }
              if (result === null || result === undefined) break;
              bytesRead++;
              buffer[offset+i] = result;
            }
            if (bytesRead) {
              stream.node.timestamp = Date.now();
            }
            return bytesRead;
          },
          write: function(stream, buffer, offset, length, pos) {
            for (var i = 0; i < length; i++) {
              try {
                output(buffer[offset+i]);
              } catch (e) {
                throw new FS.ErrnoError(5);
              }
            }
            if (length) {
              stream.node.timestamp = Date.now();
            }
            return i;
          }
        });
        return FS.mkdev(path, mode, dev);
      },createLink:function(parent, name, target, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        return FS.symlink(target, path);
      },forceLoadFile:function(obj) {
        if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
        var success = true;
        if (typeof XMLHttpRequest !== 'undefined') {
          throw new Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
        } else if (Module['read']) {
          // Command-line.
          try {
            // WARNING: Can't read binary files in V8's d8 or tracemonkey's js, as
            //          read() will try to parse UTF8.
            obj.contents = intArrayFromString(Module['read'](obj.url), true);
            obj.usedBytes = obj.contents.length;
          } catch (e) {
            success = false;
          }
        } else {
          throw new Error('Cannot load without read() or XMLHttpRequest.');
        }
        if (!success) ___setErrNo(5);
        return success;
      },createLazyFile:function(parent, name, url, canRead, canWrite) {
        // Lazy chunked Uint8Array (implements get and length from Uint8Array). Actual getting is abstracted away for eventual reuse.
        function LazyUint8Array() {
          this.lengthKnown = false;
          this.chunks = []; // Loaded chunks. Index is the chunk number
        }
        LazyUint8Array.prototype.get = function LazyUint8Array_get(idx) {
          if (idx > this.length-1 || idx < 0) {
            return undefined;
          }
          var chunkOffset = idx % this.chunkSize;
          var chunkNum = (idx / this.chunkSize)|0;
          return this.getter(chunkNum)[chunkOffset];
        }
        LazyUint8Array.prototype.setDataGetter = function LazyUint8Array_setDataGetter(getter) {
          this.getter = getter;
        }
        LazyUint8Array.prototype.cacheLength = function LazyUint8Array_cacheLength() {
          // Find length
          var xhr = new XMLHttpRequest();
          xhr.open('HEAD', url, false);
          xhr.send(null);
          if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
          var datalength = Number(xhr.getResponseHeader("Content-length"));
          var header;
          var hasByteServing = (header = xhr.getResponseHeader("Accept-Ranges")) && header === "bytes";
          var usesGzip = (header = xhr.getResponseHeader("Content-Encoding")) && header === "gzip";
  
          var chunkSize = 1024*1024; // Chunk size in bytes
  
          if (!hasByteServing) chunkSize = datalength;
  
          // Function to get a range from the remote URL.
          var doXHR = (function(from, to) {
            if (from > to) throw new Error("invalid range (" + from + ", " + to + ") or no bytes requested!");
            if (to > datalength-1) throw new Error("only " + datalength + " bytes available! programmer error!");
  
            // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            if (datalength !== chunkSize) xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);
  
            // Some hints to the browser that we want binary data.
            if (typeof Uint8Array != 'undefined') xhr.responseType = 'arraybuffer';
            if (xhr.overrideMimeType) {
              xhr.overrideMimeType('text/plain; charset=x-user-defined');
            }
  
            xhr.send(null);
            if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
            if (xhr.response !== undefined) {
              return new Uint8Array(xhr.response || []);
            } else {
              return intArrayFromString(xhr.responseText || '', true);
            }
          });
          var lazyArray = this;
          lazyArray.setDataGetter(function(chunkNum) {
            var start = chunkNum * chunkSize;
            var end = (chunkNum+1) * chunkSize - 1; // including this byte
            end = Math.min(end, datalength-1); // if datalength-1 is selected, this is the last block
            if (typeof(lazyArray.chunks[chunkNum]) === "undefined") {
              lazyArray.chunks[chunkNum] = doXHR(start, end);
            }
            if (typeof(lazyArray.chunks[chunkNum]) === "undefined") throw new Error("doXHR failed!");
            return lazyArray.chunks[chunkNum];
          });
  
          if (usesGzip || !datalength) {
            // if the server uses gzip or doesn't supply the length, we have to download the whole file to get the (uncompressed) length
            chunkSize = datalength = 1; // this will force getter(0)/doXHR do download the whole file
            datalength = this.getter(0).length;
            chunkSize = datalength;
            console.log("LazyFiles on gzip forces download of the whole file when length is accessed");
          }
  
          this._length = datalength;
          this._chunkSize = chunkSize;
          this.lengthKnown = true;
        }
        if (typeof XMLHttpRequest !== 'undefined') {
          if (!ENVIRONMENT_IS_WORKER) throw 'Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc';
          var lazyArray = new LazyUint8Array();
          Object.defineProperties(lazyArray, {
            length: {
              get: function() {
                if(!this.lengthKnown) {
                  this.cacheLength();
                }
                return this._length;
              }
            },
            chunkSize: {
              get: function() {
                if(!this.lengthKnown) {
                  this.cacheLength();
                }
                return this._chunkSize;
              }
            }
          });
  
          var properties = { isDevice: false, contents: lazyArray };
        } else {
          var properties = { isDevice: false, url: url };
        }
  
        var node = FS.createFile(parent, name, properties, canRead, canWrite);
        // This is a total hack, but I want to get this lazy file code out of the
        // core of MEMFS. If we want to keep this lazy file concept I feel it should
        // be its own thin LAZYFS proxying calls to MEMFS.
        if (properties.contents) {
          node.contents = properties.contents;
        } else if (properties.url) {
          node.contents = null;
          node.url = properties.url;
        }
        // Add a function that defers querying the file size until it is asked the first time.
        Object.defineProperties(node, {
          usedBytes: {
            get: function() { return this.contents.length; }
          }
        });
        // override each stream op with one that tries to force load the lazy file first
        var stream_ops = {};
        var keys = Object.keys(node.stream_ops);
        keys.forEach(function(key) {
          var fn = node.stream_ops[key];
          stream_ops[key] = function forceLoadLazyFile() {
            if (!FS.forceLoadFile(node)) {
              throw new FS.ErrnoError(5);
            }
            return fn.apply(null, arguments);
          };
        });
        // use a custom read function
        stream_ops.read = function stream_ops_read(stream, buffer, offset, length, position) {
          if (!FS.forceLoadFile(node)) {
            throw new FS.ErrnoError(5);
          }
          var contents = stream.node.contents;
          if (position >= contents.length)
            return 0;
          var size = Math.min(contents.length - position, length);
          assert(size >= 0);
          if (contents.slice) { // normal array
            for (var i = 0; i < size; i++) {
              buffer[offset + i] = contents[position + i];
            }
          } else {
            for (var i = 0; i < size; i++) { // LazyUint8Array from sync binary XHR
              buffer[offset + i] = contents.get(position + i);
            }
          }
          return size;
        };
        node.stream_ops = stream_ops;
        return node;
      },createPreloadedFile:function(parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn, preFinish) {
        Browser.init(); // XXX perhaps this method should move onto Browser?
        // TODO we should allow people to just pass in a complete filename instead
        // of parent and name being that we just join them anyways
        var fullname = name ? PATH.resolve(PATH.join2(parent, name)) : parent;
        var dep = getUniqueRunDependency('cp ' + fullname); // might have several active requests for the same fullname
        function processData(byteArray) {
          function finish(byteArray) {
            if (preFinish) preFinish();
            if (!dontCreateFile) {
              FS.createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
            }
            if (onload) onload();
            removeRunDependency(dep);
          }
          var handled = false;
          Module['preloadPlugins'].forEach(function(plugin) {
            if (handled) return;
            if (plugin['canHandle'](fullname)) {
              plugin['handle'](byteArray, fullname, finish, function() {
                if (onerror) onerror();
                removeRunDependency(dep);
              });
              handled = true;
            }
          });
          if (!handled) finish(byteArray);
        }
        addRunDependency(dep);
        if (typeof url == 'string') {
          Browser.asyncLoad(url, function(byteArray) {
            processData(byteArray);
          }, onerror);
        } else {
          processData(url);
        }
      },indexedDB:function() {
        return window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
      },DB_NAME:function() {
        return 'EM_FS_' + window.location.pathname;
      },DB_VERSION:20,DB_STORE_NAME:"FILE_DATA",saveFilesToDB:function(paths, onload, onerror) {
        onload = onload || function(){};
        onerror = onerror || function(){};
        var indexedDB = FS.indexedDB();
        try {
          var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
        } catch (e) {
          return onerror(e);
        }
        openRequest.onupgradeneeded = function openRequest_onupgradeneeded() {
          console.log('creating db');
          var db = openRequest.result;
          db.createObjectStore(FS.DB_STORE_NAME);
        };
        openRequest.onsuccess = function openRequest_onsuccess() {
          var db = openRequest.result;
          var transaction = db.transaction([FS.DB_STORE_NAME], 'readwrite');
          var files = transaction.objectStore(FS.DB_STORE_NAME);
          var ok = 0, fail = 0, total = paths.length;
          function finish() {
            if (fail == 0) onload(); else onerror();
          }
          paths.forEach(function(path) {
            var putRequest = files.put(FS.analyzePath(path).object.contents, path);
            putRequest.onsuccess = function putRequest_onsuccess() { ok++; if (ok + fail == total) finish() };
            putRequest.onerror = function putRequest_onerror() { fail++; if (ok + fail == total) finish() };
          });
          transaction.onerror = onerror;
        };
        openRequest.onerror = onerror;
      },loadFilesFromDB:function(paths, onload, onerror) {
        onload = onload || function(){};
        onerror = onerror || function(){};
        var indexedDB = FS.indexedDB();
        try {
          var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
        } catch (e) {
          return onerror(e);
        }
        openRequest.onupgradeneeded = onerror; // no database to load from
        openRequest.onsuccess = function openRequest_onsuccess() {
          var db = openRequest.result;
          try {
            var transaction = db.transaction([FS.DB_STORE_NAME], 'readonly');
          } catch(e) {
            onerror(e);
            return;
          }
          var files = transaction.objectStore(FS.DB_STORE_NAME);
          var ok = 0, fail = 0, total = paths.length;
          function finish() {
            if (fail == 0) onload(); else onerror();
          }
          paths.forEach(function(path) {
            var getRequest = files.get(path);
            getRequest.onsuccess = function getRequest_onsuccess() {
              if (FS.analyzePath(path).exists) {
                FS.unlink(path);
              }
              FS.createDataFile(PATH.dirname(path), PATH.basename(path), getRequest.result, true, true, true);
              ok++;
              if (ok + fail == total) finish();
            };
            getRequest.onerror = function getRequest_onerror() { fail++; if (ok + fail == total) finish() };
          });
          transaction.onerror = onerror;
        };
        openRequest.onerror = onerror;
      }};var SYSCALLS={DEFAULT_POLLMASK:5,mappings:{},umask:511,calculateAt:function(dirfd, path) {
        if (path[0] !== '/') {
          // relative path
          var dir;
          if (dirfd === -100) {
            dir = FS.cwd();
          } else {
            var dirstream = FS.getStream(dirfd);
            if (!dirstream) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
            dir = dirstream.path;
          }
          path = PATH.join2(dir, path);
        }
        return path;
      },doStat:function(func, path, buf) {
        try {
          var stat = func(path);
        } catch (e) {
          if (e && e.node && PATH.normalize(path) !== PATH.normalize(FS.getPath(e.node))) {
            // an error occurred while trying to look up the path; we should just report ENOTDIR
            return -ERRNO_CODES.ENOTDIR;
          }
          throw e;
        }
        HEAP32[((buf)>>2)]=stat.dev;
        HEAP32[(((buf)+(4))>>2)]=0;
        HEAP32[(((buf)+(8))>>2)]=stat.ino;
        HEAP32[(((buf)+(12))>>2)]=stat.mode;
        HEAP32[(((buf)+(16))>>2)]=stat.nlink;
        HEAP32[(((buf)+(20))>>2)]=stat.uid;
        HEAP32[(((buf)+(24))>>2)]=stat.gid;
        HEAP32[(((buf)+(28))>>2)]=stat.rdev;
        HEAP32[(((buf)+(32))>>2)]=0;
        (tempI64 = [stat.size>>>0,(tempDouble=stat.size,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[(((buf)+(40))>>2)]=tempI64[0],HEAP32[(((buf)+(44))>>2)]=tempI64[1]);
        HEAP32[(((buf)+(48))>>2)]=4096;
        HEAP32[(((buf)+(52))>>2)]=stat.blocks;
        HEAP32[(((buf)+(56))>>2)]=(stat.atime.getTime() / 1000)|0;
        HEAP32[(((buf)+(60))>>2)]=0;
        HEAP32[(((buf)+(64))>>2)]=(stat.mtime.getTime() / 1000)|0;
        HEAP32[(((buf)+(68))>>2)]=0;
        HEAP32[(((buf)+(72))>>2)]=(stat.ctime.getTime() / 1000)|0;
        HEAP32[(((buf)+(76))>>2)]=0;
        (tempI64 = [stat.ino>>>0,(tempDouble=stat.ino,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[(((buf)+(80))>>2)]=tempI64[0],HEAP32[(((buf)+(84))>>2)]=tempI64[1]);
        return 0;
      },doMsync:function(addr, stream, len, flags) {
        var buffer = new Uint8Array(HEAPU8.subarray(addr, addr + len));
        FS.msync(stream, buffer, 0, len, flags);
      },doMkdir:function(path, mode) {
        // remove a trailing slash, if one - /a/b/ has basename of '', but
        // we want to create b in the context of this function
        path = PATH.normalize(path);
        if (path[path.length-1] === '/') path = path.substr(0, path.length-1);
        FS.mkdir(path, mode, 0);
        return 0;
      },doMknod:function(path, mode, dev) {
        // we don't want this in the JS API as it uses mknod to create all nodes.
        switch (mode & 61440) {
          case 32768:
          case 8192:
          case 24576:
          case 4096:
          case 49152:
            break;
          default: return -ERRNO_CODES.EINVAL;
        }
        FS.mknod(path, mode, dev);
        return 0;
      },doReadlink:function(path, buf, bufsize) {
        if (bufsize <= 0) return -ERRNO_CODES.EINVAL;
        var ret = FS.readlink(path);
  
        var len = Math.min(bufsize, lengthBytesUTF8(ret));
        var endChar = HEAP8[buf+len];
        stringToUTF8(ret, buf, bufsize+1);
        // readlink is one of the rare functions that write out a C string, but does never append a null to the output buffer(!)
        // stringToUTF8() always appends a null byte, so restore the character under the null byte after the write.
        HEAP8[buf+len] = endChar;
  
        return len;
      },doAccess:function(path, amode) {
        if (amode & ~7) {
          // need a valid mode
          return -ERRNO_CODES.EINVAL;
        }
        var node;
        var lookup = FS.lookupPath(path, { follow: true });
        node = lookup.node;
        var perms = '';
        if (amode & 4) perms += 'r';
        if (amode & 2) perms += 'w';
        if (amode & 1) perms += 'x';
        if (perms /* otherwise, they've just passed F_OK */ && FS.nodePermissions(node, perms)) {
          return -ERRNO_CODES.EACCES;
        }
        return 0;
      },doDup:function(path, flags, suggestFD) {
        var suggest = FS.getStream(suggestFD);
        if (suggest) FS.close(suggest);
        return FS.open(path, flags, 0, suggestFD, suggestFD).fd;
      },doReadv:function(stream, iov, iovcnt, offset) {
        var ret = 0;
        for (var i = 0; i < iovcnt; i++) {
          var ptr = HEAP32[(((iov)+(i*8))>>2)];
          var len = HEAP32[(((iov)+(i*8 + 4))>>2)];
          var curr = FS.read(stream, HEAP8,ptr, len, offset);
          if (curr < 0) return -1;
          ret += curr;
          if (curr < len) break; // nothing more to read
        }
        return ret;
      },doWritev:function(stream, iov, iovcnt, offset) {
        var ret = 0;
        for (var i = 0; i < iovcnt; i++) {
          var ptr = HEAP32[(((iov)+(i*8))>>2)];
          var len = HEAP32[(((iov)+(i*8 + 4))>>2)];
          var curr = FS.write(stream, HEAP8,ptr, len, offset);
          if (curr < 0) return -1;
          ret += curr;
        }
        return ret;
      },varargs:0,get:function(varargs) {
        SYSCALLS.varargs += 4;
        var ret = HEAP32[(((SYSCALLS.varargs)-(4))>>2)];
        return ret;
      },getStr:function() {
        var ret = UTF8ToString(SYSCALLS.get());
        return ret;
      },getStreamFromFD:function() {
        var stream = FS.getStream(SYSCALLS.get());
        if (!stream) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        return stream;
      },getSocketFromFD:function() {
        var socket = SOCKFS.getSocket(SYSCALLS.get());
        if (!socket) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        return socket;
      },getSocketAddress:function(allowNull) {
        var addrp = SYSCALLS.get(), addrlen = SYSCALLS.get();
        if (allowNull && addrp === 0) return null;
        var info = __read_sockaddr(addrp, addrlen);
        if (info.errno) throw new FS.ErrnoError(info.errno);
        info.addr = DNS.lookup_addr(info.addr) || info.addr;
        return info;
      },get64:function() {
        var low = SYSCALLS.get(), high = SYSCALLS.get();
        if (low >= 0) assert(high === 0);
        else assert(high === -1);
        return low;
      },getZero:function() {
        assert(SYSCALLS.get() === 0);
      }};function ___syscall12(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // chdir
      var path = SYSCALLS.getStr();
      FS.chdir(path);
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall122(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // uname
      var buf = SYSCALLS.get();
      if (!buf) return -ERRNO_CODES.EFAULT
      var layout = {"__size__":390,"sysname":0,"nodename":65,"release":130,"version":195,"machine":260,"domainname":325};
      var copyString = function(element, value) {
        var offset = layout[element];
        writeAsciiToMemory(value, buf + offset);
      };
      copyString('sysname', 'Emscripten');
      copyString('nodename', 'emscripten');
      copyString('release', '1.0');
      copyString('version', '#1');
      copyString('machine', 'x86-JS');
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall125(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // mprotect
      return 0; // let's not and say we did
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall140(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // llseek
      var stream = SYSCALLS.getStreamFromFD(), offset_high = SYSCALLS.get(), offset_low = SYSCALLS.get(), result = SYSCALLS.get(), whence = SYSCALLS.get();
      // Can't handle 64-bit integers
      if (!(offset_high == -1 && offset_low < 0) &&
          !(offset_high == 0 && offset_low >= 0)) {
        return -ERRNO_CODES.EOVERFLOW;
      }
      var offset = offset_low;
      FS.llseek(stream, offset, whence);
      (tempI64 = [stream.position>>>0,(tempDouble=stream.position,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((result)>>2)]=tempI64[0],HEAP32[(((result)+(4))>>2)]=tempI64[1]);
      if (stream.getdents && offset === 0 && whence === 0) stream.getdents = null; // reset readdir state
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall142(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // newselect
      // readfds are supported,
      // writefds checks socket open status
      // exceptfds not supported
      // timeout is always 0 - fully async
      var nfds = SYSCALLS.get(), readfds = SYSCALLS.get(), writefds = SYSCALLS.get(), exceptfds = SYSCALLS.get(), timeout = SYSCALLS.get();
  
      assert(nfds <= 64, 'nfds must be less than or equal to 64');  // fd sets have 64 bits // TODO: this could be 1024 based on current musl headers
      assert(!exceptfds, 'exceptfds not supported');
  
      var total = 0;
      
      var srcReadLow = (readfds ? HEAP32[((readfds)>>2)] : 0),
          srcReadHigh = (readfds ? HEAP32[(((readfds)+(4))>>2)] : 0);
      var srcWriteLow = (writefds ? HEAP32[((writefds)>>2)] : 0),
          srcWriteHigh = (writefds ? HEAP32[(((writefds)+(4))>>2)] : 0);
      var srcExceptLow = (exceptfds ? HEAP32[((exceptfds)>>2)] : 0),
          srcExceptHigh = (exceptfds ? HEAP32[(((exceptfds)+(4))>>2)] : 0);
  
      var dstReadLow = 0,
          dstReadHigh = 0;
      var dstWriteLow = 0,
          dstWriteHigh = 0;
      var dstExceptLow = 0,
          dstExceptHigh = 0;
  
      var allLow = (readfds ? HEAP32[((readfds)>>2)] : 0) |
                   (writefds ? HEAP32[((writefds)>>2)] : 0) |
                   (exceptfds ? HEAP32[((exceptfds)>>2)] : 0);
      var allHigh = (readfds ? HEAP32[(((readfds)+(4))>>2)] : 0) |
                    (writefds ? HEAP32[(((writefds)+(4))>>2)] : 0) |
                    (exceptfds ? HEAP32[(((exceptfds)+(4))>>2)] : 0);
  
      var check = function(fd, low, high, val) {
        return (fd < 32 ? (low & val) : (high & val));
      };
  
      for (var fd = 0; fd < nfds; fd++) {
        var mask = 1 << (fd % 32);
        if (!(check(fd, allLow, allHigh, mask))) {
          continue;  // index isn't in the set
        }
  
        var stream = FS.getStream(fd);
        if (!stream) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
  
        var flags = SYSCALLS.DEFAULT_POLLMASK;
  
        if (stream.stream_ops.poll) {
          flags = stream.stream_ops.poll(stream);
        }
  
        if ((flags & 1) && check(fd, srcReadLow, srcReadHigh, mask)) {
          fd < 32 ? (dstReadLow = dstReadLow | mask) : (dstReadHigh = dstReadHigh | mask);
          total++;
        }
        if ((flags & 4) && check(fd, srcWriteLow, srcWriteHigh, mask)) {
          fd < 32 ? (dstWriteLow = dstWriteLow | mask) : (dstWriteHigh = dstWriteHigh | mask);
          total++;
        }
        if ((flags & 2) && check(fd, srcExceptLow, srcExceptHigh, mask)) {
          fd < 32 ? (dstExceptLow = dstExceptLow | mask) : (dstExceptHigh = dstExceptHigh | mask);
          total++;
        }
      }
  
      if (readfds) {
        HEAP32[((readfds)>>2)]=dstReadLow;
        HEAP32[(((readfds)+(4))>>2)]=dstReadHigh;
      }
      if (writefds) {
        HEAP32[((writefds)>>2)]=dstWriteLow;
        HEAP32[(((writefds)+(4))>>2)]=dstWriteHigh;
      }
      if (exceptfds) {
        HEAP32[((exceptfds)>>2)]=dstExceptLow;
        HEAP32[(((exceptfds)+(4))>>2)]=dstExceptHigh;
      }
      
      return total;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall146(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // writev
      var stream = SYSCALLS.getStreamFromFD(), iov = SYSCALLS.get(), iovcnt = SYSCALLS.get();
      return SYSCALLS.doWritev(stream, iov, iovcnt);
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall181(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // pwrite64
      var stream = SYSCALLS.getStreamFromFD(), buf = SYSCALLS.get(), count = SYSCALLS.get(), zero = SYSCALLS.getZero(), offset = SYSCALLS.get64();
      return FS.write(stream, HEAP8,buf, count, offset);
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall183(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // getcwd
      var buf = SYSCALLS.get(), size = SYSCALLS.get();
      if (size === 0) return -ERRNO_CODES.EINVAL;
      var cwd = FS.cwd();
      var cwdLengthInBytes = lengthBytesUTF8(cwd);
      if (size < cwdLengthInBytes + 1) return -ERRNO_CODES.ERANGE;
      stringToUTF8(cwd, buf, size);
      return buf;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall191(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // ugetrlimit
      var resource = SYSCALLS.get(), rlim = SYSCALLS.get();
      HEAP32[((rlim)>>2)]=-1;  // RLIM_INFINITY
      HEAP32[(((rlim)+(4))>>2)]=-1;  // RLIM_INFINITY
      HEAP32[(((rlim)+(8))>>2)]=-1;  // RLIM_INFINITY
      HEAP32[(((rlim)+(12))>>2)]=-1;  // RLIM_INFINITY
      return 0; // just report no limits
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall192(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // mmap2
      var addr = SYSCALLS.get(), len = SYSCALLS.get(), prot = SYSCALLS.get(), flags = SYSCALLS.get(), fd = SYSCALLS.get(), off = SYSCALLS.get()
      off <<= 12; // undo pgoffset
      var ptr;
      var allocated = false;
      if (fd === -1) {
        ptr = _memalign(PAGE_SIZE, len);
        if (!ptr) return -ERRNO_CODES.ENOMEM;
        _memset(ptr, 0, len);
        allocated = true;
      } else {
        var info = FS.getStream(fd);
        if (!info) return -ERRNO_CODES.EBADF;
        var res = FS.mmap(info, HEAPU8, addr, len, off, prot, flags);
        ptr = res.ptr;
        allocated = res.allocated;
      }
      SYSCALLS.mappings[ptr] = { malloc: ptr, len: len, allocated: allocated, fd: fd, flags: flags };
      return ptr;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall194(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // ftruncate64
      var fd = SYSCALLS.get(), zero = SYSCALLS.getZero(), length = SYSCALLS.get64();
      FS.ftruncate(fd, length);
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall195(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // SYS_stat64
      var path = SYSCALLS.getStr(), buf = SYSCALLS.get();
      return SYSCALLS.doStat(FS.stat, path, buf);
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall196(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // SYS_lstat64
      var path = SYSCALLS.getStr(), buf = SYSCALLS.get();
      return SYSCALLS.doStat(FS.lstat, path, buf);
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall197(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // SYS_fstat64
      var stream = SYSCALLS.getStreamFromFD(), buf = SYSCALLS.get();
      return SYSCALLS.doStat(FS.stat, stream.path, buf);
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  
  var PROCINFO={ppid:1,pid:42,sid:42,pgid:42};function ___syscall20(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // getpid
      return PROCINFO.pid;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall219(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // madvise
      return 0; // advice is welcome, but ignored
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall221(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // fcntl64
      var stream = SYSCALLS.getStreamFromFD(), cmd = SYSCALLS.get();
      switch (cmd) {
        case 0: {
          var arg = SYSCALLS.get();
          if (arg < 0) {
            return -ERRNO_CODES.EINVAL;
          }
          var newStream;
          newStream = FS.open(stream.path, stream.flags, 0, arg);
          return newStream.fd;
        }
        case 1:
        case 2:
          return 0;  // FD_CLOEXEC makes no sense for a single process.
        case 3:
          return stream.flags;
        case 4: {
          var arg = SYSCALLS.get();
          stream.flags |= arg;
          return 0;
        }
        case 12:
        /* case 12: Currently in musl F_GETLK64 has same value as F_GETLK, so omitted to avoid duplicate case blocks. If that changes, uncomment this */ {
          
          var arg = SYSCALLS.get();
          var offset = 0;
          // We're always unlocked.
          HEAP16[(((arg)+(offset))>>1)]=2;
          return 0;
        }
        case 13:
        case 14:
        /* case 13: Currently in musl F_SETLK64 has same value as F_SETLK, so omitted to avoid duplicate case blocks. If that changes, uncomment this */
        /* case 14: Currently in musl F_SETLKW64 has same value as F_SETLKW, so omitted to avoid duplicate case blocks. If that changes, uncomment this */
          
          
          return 0; // Pretend that the locking is successful.
        case 16:
        case 8:
          return -ERRNO_CODES.EINVAL; // These are for sockets. We don't have them fully implemented yet.
        case 9:
          // musl trusts getown return values, due to a bug where they must be, as they overlap with errors. just return -1 here, so fnctl() returns that, and we set errno ourselves.
          ___setErrNo(ERRNO_CODES.EINVAL);
          return -1;
        default: {
          return -ERRNO_CODES.EINVAL;
        }
      }
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall3(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // read
      var stream = SYSCALLS.getStreamFromFD(), buf = SYSCALLS.get(), count = SYSCALLS.get();
      return FS.read(stream, HEAP8,buf, count);
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall340(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // prlimit64
      var pid = SYSCALLS.get(), resource = SYSCALLS.get(), new_limit = SYSCALLS.get(), old_limit = SYSCALLS.get();
      if (old_limit) { // just report no limits
        HEAP32[((old_limit)>>2)]=-1;  // RLIM_INFINITY
        HEAP32[(((old_limit)+(4))>>2)]=-1;  // RLIM_INFINITY
        HEAP32[(((old_limit)+(8))>>2)]=-1;  // RLIM_INFINITY
        HEAP32[(((old_limit)+(12))>>2)]=-1;  // RLIM_INFINITY
      }
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall38(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // rename
      var old_path = SYSCALLS.getStr(), new_path = SYSCALLS.getStr();
      FS.rename(old_path, new_path);
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall4(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // write
      var stream = SYSCALLS.getStreamFromFD(), buf = SYSCALLS.get(), count = SYSCALLS.get();
      return FS.write(stream, HEAP8,buf, count);
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall5(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // open
      var pathname = SYSCALLS.getStr(), flags = SYSCALLS.get(), mode = SYSCALLS.get() // optional TODO
      var stream = FS.open(pathname, flags, mode);
      return stream.fd;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall54(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // ioctl
      var stream = SYSCALLS.getStreamFromFD(), op = SYSCALLS.get();
      switch (op) {
        case 21509:
        case 21505: {
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          return 0;
        }
        case 21510:
        case 21511:
        case 21512:
        case 21506:
        case 21507:
        case 21508: {
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          return 0; // no-op, not actually adjusting terminal settings
        }
        case 21519: {
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          var argp = SYSCALLS.get();
          HEAP32[((argp)>>2)]=0;
          return 0;
        }
        case 21520: {
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          return -ERRNO_CODES.EINVAL; // not supported
        }
        case 21531: {
          var argp = SYSCALLS.get();
          return FS.ioctl(stream, op, argp);
        }
        case 21523: {
          // TODO: in theory we should write to the winsize struct that gets
          // passed in, but for now musl doesn't read anything on it
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          return 0;
        }
        case 21524: {
          // TODO: technically, this ioctl call should change the window size.
          // but, since emscripten doesn't have any concept of a terminal window
          // yet, we'll just silently throw it away as we do TIOCGWINSZ
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          return 0;
        }
        default: abort('bad ioctl syscall ' + op);
      }
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall6(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // close
      var stream = SYSCALLS.getStreamFromFD();
      FS.close(stream);
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall85(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // readlink
      var path = SYSCALLS.getStr(), buf = SYSCALLS.get(), bufsize = SYSCALLS.get();
      return SYSCALLS.doReadlink(path, buf, bufsize);
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall91(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // munmap
      var addr = SYSCALLS.get(), len = SYSCALLS.get();
      // TODO: support unmmap'ing parts of allocations
      var info = SYSCALLS.mappings[addr];
      if (!info) return 0;
      if (len === info.len) {
        var stream = FS.getStream(info.fd);
        SYSCALLS.doMsync(addr, stream, len, info.flags)
        FS.munmap(stream);
        SYSCALLS.mappings[addr] = null;
        if (info.allocated) {
          _free(info.malloc);
        }
      }
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

   

  function ___unlock() {}

   

  function ___wait() {}

  function _abort() {
      Module['abort']();
    }

   

   

   


  
  function _dlopen(/* ... */) {
      abort("To use dlopen, you need to use Emscripten's linking support, see https://github.com/emscripten-core/emscripten/wiki/Linking");
    }function _dladdr(
  ) {
  return _dlopen.apply(null, arguments)
  }

  function _dlclose(
  ) {
  return _dlopen.apply(null, arguments)
  }

  function _dlerror(
  ) {
  return _dlopen.apply(null, arguments)
  }

  function _dlinfo(
  ) {
  if (!Module['_dlinfo']) abort("external function 'dlinfo' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_dlinfo'].apply(null, arguments);
  }


  function _dlsym(
  ) {
  return _dlopen.apply(null, arguments)
  }

  function _emscripten_get_heap_size() {
      return HEAP8.length;
    }

  
  
   
  
   
  
   function _longjmp(env, value) {
      _setThrew(env, value || 1);
      throw 'longjmp';
    }function _emscripten_longjmp(env, value) {
      _longjmp(env, value);
    }

  
  function abortOnCannotGrowMemory(requestedSize) {
      abort('Cannot enlarge memory arrays to size ' + requestedSize + ' bytes (OOM). Either (1) compile with  -s TOTAL_MEMORY=X  with X higher than the current value ' + HEAP8.length + ', (2) compile with  -s ALLOW_MEMORY_GROWTH=1  which allows increasing the size at runtime, or (3) if you want malloc to return NULL (0) instead of this abort, compile with  -s ABORTING_MALLOC=0 ');
    }
  
  function emscripten_realloc_buffer(size) {
      var PAGE_MULTIPLE = 65536;
      size = alignUp(size, PAGE_MULTIPLE); // round up to wasm page size
      var oldSize = buffer.byteLength;
      // native wasm support
      // note that this is *not* threadsafe. multiple threads can call .grow(), and each
      // presents a delta, so in theory we may over-allocate here (e.g. if two threads
      // ask to grow from 256MB to 512MB, we get 2 requests to add +256MB, and may end
      // up growing to 768MB (even though we may have been able to make do with 512MB).
      // TODO: consider decreasing the step sizes in emscripten_resize_heap
      try {
        var result = wasmMemory.grow((size - oldSize) / 65536); // .grow() takes a delta compared to the previous size
        if (result !== (-1 | 0)) {
          // success in native wasm memory growth, get the buffer from the memory
          buffer = wasmMemory.buffer;
          return true;
        } else {
          return false;
        }
      } catch(e) {
        console.error('emscripten_realloc_buffer: Attempted to grow from ' + oldSize  + ' bytes to ' + size + ' bytes, but got error: ' + e);
        return false;
      }
    }function _emscripten_resize_heap(requestedSize) {
      var oldSize = _emscripten_get_heap_size();
      // With pthreads, races can happen (another thread might increase the size in between), so return a failure, and let the caller retry.
      assert(requestedSize > oldSize);
  
  
      var PAGE_MULTIPLE = 65536;
      var LIMIT = 2147483648 - PAGE_MULTIPLE; // We can do one page short of 2GB as theoretical maximum.
  
      if (requestedSize > LIMIT) {
        err('Cannot enlarge memory, asked to go up to ' + requestedSize + ' bytes, but the limit is ' + LIMIT + ' bytes!');
        return false;
      }
  
      var MIN_TOTAL_MEMORY = 16777216;
      var newSize = Math.max(oldSize, MIN_TOTAL_MEMORY); // So the loop below will not be infinite, and minimum asm.js memory size is 16MB.
  
      // TODO: see realloc_buffer - for PTHREADS we may want to decrease these jumps
      while (newSize < requestedSize) { // Keep incrementing the heap size as long as it's less than what is requested.
        if (newSize <= 536870912) {
          newSize = alignUp(2 * newSize, PAGE_MULTIPLE); // Simple heuristic: double until 1GB...
        } else {
          // ..., but after that, add smaller increments towards 2GB, which we cannot reach
          newSize = Math.min(alignUp((3 * newSize + 2147483648) / 4, PAGE_MULTIPLE), LIMIT);
          if (newSize === oldSize) {
            warnOnce('Cannot ask for more memory since we reached the practical limit in browsers (which is just below 2GB), so the request would have failed. Requesting only ' + HEAP8.length);
          }
        }
      }
  
  
      var start = Date.now();
  
      if (!emscripten_realloc_buffer(newSize)) {
        err('Failed to grow the heap from ' + oldSize + ' bytes to ' + newSize + ' bytes, not enough memory!');
        return false;
      }
  
      updateGlobalBufferViews();
  
  
  
      return true;
    }

  function _exit(status) {
      // void _exit(int status);
      // http://pubs.opengroup.org/onlinepubs/000095399/functions/exit.html
      exit(status);
    }

  function _getenv(name) {
      // char *getenv(const char *name);
      // http://pubs.opengroup.org/onlinepubs/009695399/functions/getenv.html
      if (name === 0) return 0;
      name = UTF8ToString(name);
      if (!ENV.hasOwnProperty(name)) return 0;
  
      if (_getenv.ret) _free(_getenv.ret);
      _getenv.ret = allocateUTF8(ENV[name]);
      return _getenv.ret;
    }

  function _gettimeofday(ptr) {
      var now = Date.now();
      HEAP32[((ptr)>>2)]=(now/1000)|0; // seconds
      HEAP32[(((ptr)+(4))>>2)]=((now % 1000)*1000)|0; // microseconds
      return 0;
    }

  function _i32_from_id(id) {
          return $("#" + UTF8ToString(id+4))[0].value; 
      }



  function _jl_deserialize_verify_header(
  ) {
  if (!Module['_jl_deserialize_verify_header']) abort("external function 'jl_deserialize_verify_header' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_jl_deserialize_verify_header'].apply(null, arguments);
  }

  function _jl_dump_fptr_asm(
  ) {
  if (!Module['_jl_dump_fptr_asm']) abort("external function 'jl_dump_fptr_asm' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_jl_dump_fptr_asm'].apply(null, arguments);
  }

  function _jl_threading_profile(
  ) {
  if (!Module['_jl_threading_profile']) abort("external function 'jl_threading_profile' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_jl_threading_profile'].apply(null, arguments);
  }

   

  function _llvm_copysign_f32(x, y) {
      return y < 0 || (y === 0 && 1/y < 0) ? -Math_abs(x) : Math_abs(x);
    }

  function _llvm_copysign_f64(x, y) {
      return y < 0 || (y === 0 && 1/y < 0) ? -Math_abs(x) : Math_abs(x);
    }

   

  
    


  function _llvm_cttz_i64(l, h) {
      var ret = _llvm_cttz_i32(l);
      if (ret == 32) ret += _llvm_cttz_i32(h);
      return ((setTempRet0(0),ret)|0);
    }

  function _llvm_fma_f32(
  ) {
  if (!Module['_llvm_fma_f32']) abort("external function 'llvm_fma_f32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_llvm_fma_f32'].apply(null, arguments);
  }

  function _llvm_fma_f64(
  ) {
  if (!Module['_llvm_fma_f64']) abort("external function 'llvm_fma_f64' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_llvm_fma_f64'].apply(null, arguments);
  }

  function _llvm_frameaddress(
  ) {
  if (!Module['_llvm_frameaddress']) abort("external function 'llvm_frameaddress' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_llvm_frameaddress'].apply(null, arguments);
  }

  
  
    

  
    

  var _llvm_trunc_f32=Math_trunc;

  var _llvm_trunc_f64=Math_trunc;


  
  function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.set(HEAPU8.subarray(src, src+num), dest);
    }
  
   

   

   

  function _mpfr_abs(
  ) {
  if (!Module['_mpfr_abs']) abort("external function 'mpfr_abs' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_abs'].apply(null, arguments);
  }

  function _mpfr_acos(
  ) {
  if (!Module['_mpfr_acos']) abort("external function 'mpfr_acos' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_acos'].apply(null, arguments);
  }

  function _mpfr_acosh(
  ) {
  if (!Module['_mpfr_acosh']) abort("external function 'mpfr_acosh' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_acosh'].apply(null, arguments);
  }

  function _mpfr_add(
  ) {
  if (!Module['_mpfr_add']) abort("external function 'mpfr_add' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_add'].apply(null, arguments);
  }

  function _mpfr_add_d(
  ) {
  if (!Module['_mpfr_add_d']) abort("external function 'mpfr_add_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_add_d'].apply(null, arguments);
  }

  function _mpfr_add_q(
  ) {
  if (!Module['_mpfr_add_q']) abort("external function 'mpfr_add_q' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_add_q'].apply(null, arguments);
  }

  function _mpfr_add_si(
  ) {
  if (!Module['_mpfr_add_si']) abort("external function 'mpfr_add_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_add_si'].apply(null, arguments);
  }

  function _mpfr_add_ui(
  ) {
  if (!Module['_mpfr_add_ui']) abort("external function 'mpfr_add_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_add_ui'].apply(null, arguments);
  }

  function _mpfr_add_z(
  ) {
  if (!Module['_mpfr_add_z']) abort("external function 'mpfr_add_z' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_add_z'].apply(null, arguments);
  }

  function _mpfr_agm(
  ) {
  if (!Module['_mpfr_agm']) abort("external function 'mpfr_agm' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_agm'].apply(null, arguments);
  }

  function _mpfr_ai(
  ) {
  if (!Module['_mpfr_ai']) abort("external function 'mpfr_ai' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_ai'].apply(null, arguments);
  }

  function _mpfr_asin(
  ) {
  if (!Module['_mpfr_asin']) abort("external function 'mpfr_asin' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_asin'].apply(null, arguments);
  }

  function _mpfr_asinh(
  ) {
  if (!Module['_mpfr_asinh']) abort("external function 'mpfr_asinh' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_asinh'].apply(null, arguments);
  }

  function _mpfr_asprintf(
  ) {
  if (!Module['_mpfr_asprintf']) abort("external function 'mpfr_asprintf' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_asprintf'].apply(null, arguments);
  }

  function _mpfr_atan(
  ) {
  if (!Module['_mpfr_atan']) abort("external function 'mpfr_atan' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_atan'].apply(null, arguments);
  }

  function _mpfr_atan2(
  ) {
  if (!Module['_mpfr_atan2']) abort("external function 'mpfr_atan2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_atan2'].apply(null, arguments);
  }

  function _mpfr_atanh(
  ) {
  if (!Module['_mpfr_atanh']) abort("external function 'mpfr_atanh' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_atanh'].apply(null, arguments);
  }

  function _mpfr_beta(
  ) {
  if (!Module['_mpfr_beta']) abort("external function 'mpfr_beta' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_beta'].apply(null, arguments);
  }

  function _mpfr_buildopt_decimal_p(
  ) {
  if (!Module['_mpfr_buildopt_decimal_p']) abort("external function 'mpfr_buildopt_decimal_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_buildopt_decimal_p'].apply(null, arguments);
  }

  function _mpfr_buildopt_float128_p(
  ) {
  if (!Module['_mpfr_buildopt_float128_p']) abort("external function 'mpfr_buildopt_float128_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_buildopt_float128_p'].apply(null, arguments);
  }

  function _mpfr_buildopt_gmpinternals_p(
  ) {
  if (!Module['_mpfr_buildopt_gmpinternals_p']) abort("external function 'mpfr_buildopt_gmpinternals_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_buildopt_gmpinternals_p'].apply(null, arguments);
  }

  function _mpfr_buildopt_sharedcache_p(
  ) {
  if (!Module['_mpfr_buildopt_sharedcache_p']) abort("external function 'mpfr_buildopt_sharedcache_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_buildopt_sharedcache_p'].apply(null, arguments);
  }

  function _mpfr_buildopt_tls_p(
  ) {
  if (!Module['_mpfr_buildopt_tls_p']) abort("external function 'mpfr_buildopt_tls_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_buildopt_tls_p'].apply(null, arguments);
  }

  function _mpfr_buildopt_tune_case(
  ) {
  if (!Module['_mpfr_buildopt_tune_case']) abort("external function 'mpfr_buildopt_tune_case' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_buildopt_tune_case'].apply(null, arguments);
  }

  function _mpfr_can_round(
  ) {
  if (!Module['_mpfr_can_round']) abort("external function 'mpfr_can_round' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_can_round'].apply(null, arguments);
  }

  function _mpfr_cbrt(
  ) {
  if (!Module['_mpfr_cbrt']) abort("external function 'mpfr_cbrt' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cbrt'].apply(null, arguments);
  }

  function _mpfr_ceil(
  ) {
  if (!Module['_mpfr_ceil']) abort("external function 'mpfr_ceil' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_ceil'].apply(null, arguments);
  }

  function _mpfr_check_range(
  ) {
  if (!Module['_mpfr_check_range']) abort("external function 'mpfr_check_range' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_check_range'].apply(null, arguments);
  }

  function _mpfr_clear(
  ) {
  if (!Module['_mpfr_clear']) abort("external function 'mpfr_clear' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_clear'].apply(null, arguments);
  }

  function _mpfr_clear_divby0(
  ) {
  if (!Module['_mpfr_clear_divby0']) abort("external function 'mpfr_clear_divby0' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_clear_divby0'].apply(null, arguments);
  }

  function _mpfr_clear_erangeflag(
  ) {
  if (!Module['_mpfr_clear_erangeflag']) abort("external function 'mpfr_clear_erangeflag' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_clear_erangeflag'].apply(null, arguments);
  }

  function _mpfr_clear_flags(
  ) {
  if (!Module['_mpfr_clear_flags']) abort("external function 'mpfr_clear_flags' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_clear_flags'].apply(null, arguments);
  }

  function _mpfr_clear_inexflag(
  ) {
  if (!Module['_mpfr_clear_inexflag']) abort("external function 'mpfr_clear_inexflag' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_clear_inexflag'].apply(null, arguments);
  }

  function _mpfr_clear_nanflag(
  ) {
  if (!Module['_mpfr_clear_nanflag']) abort("external function 'mpfr_clear_nanflag' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_clear_nanflag'].apply(null, arguments);
  }

  function _mpfr_clear_overflow(
  ) {
  if (!Module['_mpfr_clear_overflow']) abort("external function 'mpfr_clear_overflow' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_clear_overflow'].apply(null, arguments);
  }

  function _mpfr_clear_underflow(
  ) {
  if (!Module['_mpfr_clear_underflow']) abort("external function 'mpfr_clear_underflow' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_clear_underflow'].apply(null, arguments);
  }

  function _mpfr_clears(
  ) {
  if (!Module['_mpfr_clears']) abort("external function 'mpfr_clears' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_clears'].apply(null, arguments);
  }

  function _mpfr_cmp(
  ) {
  if (!Module['_mpfr_cmp']) abort("external function 'mpfr_cmp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cmp'].apply(null, arguments);
  }

  function _mpfr_cmp3(
  ) {
  if (!Module['_mpfr_cmp3']) abort("external function 'mpfr_cmp3' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cmp3'].apply(null, arguments);
  }

  function _mpfr_cmp_d(
  ) {
  if (!Module['_mpfr_cmp_d']) abort("external function 'mpfr_cmp_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cmp_d'].apply(null, arguments);
  }

  function _mpfr_cmp_f(
  ) {
  if (!Module['_mpfr_cmp_f']) abort("external function 'mpfr_cmp_f' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cmp_f'].apply(null, arguments);
  }

  function _mpfr_cmp_ld(
  ) {
  if (!Module['_mpfr_cmp_ld']) abort("external function 'mpfr_cmp_ld' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cmp_ld'].apply(null, arguments);
  }

  function _mpfr_cmp_q(
  ) {
  if (!Module['_mpfr_cmp_q']) abort("external function 'mpfr_cmp_q' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cmp_q'].apply(null, arguments);
  }

  function _mpfr_cmp_si(
  ) {
  if (!Module['_mpfr_cmp_si']) abort("external function 'mpfr_cmp_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cmp_si'].apply(null, arguments);
  }

  function _mpfr_cmp_si_2exp(
  ) {
  if (!Module['_mpfr_cmp_si_2exp']) abort("external function 'mpfr_cmp_si_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cmp_si_2exp'].apply(null, arguments);
  }

  function _mpfr_cmp_ui(
  ) {
  if (!Module['_mpfr_cmp_ui']) abort("external function 'mpfr_cmp_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cmp_ui'].apply(null, arguments);
  }

  function _mpfr_cmp_ui_2exp(
  ) {
  if (!Module['_mpfr_cmp_ui_2exp']) abort("external function 'mpfr_cmp_ui_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cmp_ui_2exp'].apply(null, arguments);
  }

  function _mpfr_cmp_z(
  ) {
  if (!Module['_mpfr_cmp_z']) abort("external function 'mpfr_cmp_z' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cmp_z'].apply(null, arguments);
  }

  function _mpfr_cmpabs(
  ) {
  if (!Module['_mpfr_cmpabs']) abort("external function 'mpfr_cmpabs' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cmpabs'].apply(null, arguments);
  }

  function _mpfr_const_catalan(
  ) {
  if (!Module['_mpfr_const_catalan']) abort("external function 'mpfr_const_catalan' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_const_catalan'].apply(null, arguments);
  }

  function _mpfr_const_euler(
  ) {
  if (!Module['_mpfr_const_euler']) abort("external function 'mpfr_const_euler' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_const_euler'].apply(null, arguments);
  }

  function _mpfr_const_log2(
  ) {
  if (!Module['_mpfr_const_log2']) abort("external function 'mpfr_const_log2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_const_log2'].apply(null, arguments);
  }

  function _mpfr_const_pi(
  ) {
  if (!Module['_mpfr_const_pi']) abort("external function 'mpfr_const_pi' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_const_pi'].apply(null, arguments);
  }

  function _mpfr_copysign(
  ) {
  if (!Module['_mpfr_copysign']) abort("external function 'mpfr_copysign' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_copysign'].apply(null, arguments);
  }

  function _mpfr_cos(
  ) {
  if (!Module['_mpfr_cos']) abort("external function 'mpfr_cos' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cos'].apply(null, arguments);
  }

  function _mpfr_cosh(
  ) {
  if (!Module['_mpfr_cosh']) abort("external function 'mpfr_cosh' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cosh'].apply(null, arguments);
  }

  function _mpfr_cot(
  ) {
  if (!Module['_mpfr_cot']) abort("external function 'mpfr_cot' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_cot'].apply(null, arguments);
  }

  function _mpfr_coth(
  ) {
  if (!Module['_mpfr_coth']) abort("external function 'mpfr_coth' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_coth'].apply(null, arguments);
  }

  function _mpfr_csc(
  ) {
  if (!Module['_mpfr_csc']) abort("external function 'mpfr_csc' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_csc'].apply(null, arguments);
  }

  function _mpfr_csch(
  ) {
  if (!Module['_mpfr_csch']) abort("external function 'mpfr_csch' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_csch'].apply(null, arguments);
  }

  function _mpfr_custom_get_exp(
  ) {
  if (!Module['_mpfr_custom_get_exp']) abort("external function 'mpfr_custom_get_exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_custom_get_exp'].apply(null, arguments);
  }

  function _mpfr_custom_get_kind(
  ) {
  if (!Module['_mpfr_custom_get_kind']) abort("external function 'mpfr_custom_get_kind' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_custom_get_kind'].apply(null, arguments);
  }

  function _mpfr_custom_get_significand(
  ) {
  if (!Module['_mpfr_custom_get_significand']) abort("external function 'mpfr_custom_get_significand' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_custom_get_significand'].apply(null, arguments);
  }

  function _mpfr_custom_get_size(
  ) {
  if (!Module['_mpfr_custom_get_size']) abort("external function 'mpfr_custom_get_size' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_custom_get_size'].apply(null, arguments);
  }

  function _mpfr_custom_init(
  ) {
  if (!Module['_mpfr_custom_init']) abort("external function 'mpfr_custom_init' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_custom_init'].apply(null, arguments);
  }

  function _mpfr_custom_init_set(
  ) {
  if (!Module['_mpfr_custom_init_set']) abort("external function 'mpfr_custom_init_set' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_custom_init_set'].apply(null, arguments);
  }

  function _mpfr_custom_move(
  ) {
  if (!Module['_mpfr_custom_move']) abort("external function 'mpfr_custom_move' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_custom_move'].apply(null, arguments);
  }

  function _mpfr_d_div(
  ) {
  if (!Module['_mpfr_d_div']) abort("external function 'mpfr_d_div' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_d_div'].apply(null, arguments);
  }

  function _mpfr_d_sub(
  ) {
  if (!Module['_mpfr_d_sub']) abort("external function 'mpfr_d_sub' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_d_sub'].apply(null, arguments);
  }

  function _mpfr_digamma(
  ) {
  if (!Module['_mpfr_digamma']) abort("external function 'mpfr_digamma' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_digamma'].apply(null, arguments);
  }

  function _mpfr_dim(
  ) {
  if (!Module['_mpfr_dim']) abort("external function 'mpfr_dim' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_dim'].apply(null, arguments);
  }

  function _mpfr_div(
  ) {
  if (!Module['_mpfr_div']) abort("external function 'mpfr_div' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_div'].apply(null, arguments);
  }

  function _mpfr_div_2exp(
  ) {
  if (!Module['_mpfr_div_2exp']) abort("external function 'mpfr_div_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_div_2exp'].apply(null, arguments);
  }

  function _mpfr_div_2si(
  ) {
  if (!Module['_mpfr_div_2si']) abort("external function 'mpfr_div_2si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_div_2si'].apply(null, arguments);
  }

  function _mpfr_div_2ui(
  ) {
  if (!Module['_mpfr_div_2ui']) abort("external function 'mpfr_div_2ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_div_2ui'].apply(null, arguments);
  }

  function _mpfr_div_d(
  ) {
  if (!Module['_mpfr_div_d']) abort("external function 'mpfr_div_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_div_d'].apply(null, arguments);
  }

  function _mpfr_div_q(
  ) {
  if (!Module['_mpfr_div_q']) abort("external function 'mpfr_div_q' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_div_q'].apply(null, arguments);
  }

  function _mpfr_div_si(
  ) {
  if (!Module['_mpfr_div_si']) abort("external function 'mpfr_div_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_div_si'].apply(null, arguments);
  }

  function _mpfr_div_ui(
  ) {
  if (!Module['_mpfr_div_ui']) abort("external function 'mpfr_div_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_div_ui'].apply(null, arguments);
  }

  function _mpfr_div_z(
  ) {
  if (!Module['_mpfr_div_z']) abort("external function 'mpfr_div_z' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_div_z'].apply(null, arguments);
  }

  function _mpfr_divby0_p(
  ) {
  if (!Module['_mpfr_divby0_p']) abort("external function 'mpfr_divby0_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_divby0_p'].apply(null, arguments);
  }

  function _mpfr_dump(
  ) {
  if (!Module['_mpfr_dump']) abort("external function 'mpfr_dump' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_dump'].apply(null, arguments);
  }

  function _mpfr_eint(
  ) {
  if (!Module['_mpfr_eint']) abort("external function 'mpfr_eint' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_eint'].apply(null, arguments);
  }

  function _mpfr_eq(
  ) {
  if (!Module['_mpfr_eq']) abort("external function 'mpfr_eq' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_eq'].apply(null, arguments);
  }

  function _mpfr_equal_p(
  ) {
  if (!Module['_mpfr_equal_p']) abort("external function 'mpfr_equal_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_equal_p'].apply(null, arguments);
  }

  function _mpfr_erandom(
  ) {
  if (!Module['_mpfr_erandom']) abort("external function 'mpfr_erandom' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_erandom'].apply(null, arguments);
  }

  function _mpfr_erangeflag_p(
  ) {
  if (!Module['_mpfr_erangeflag_p']) abort("external function 'mpfr_erangeflag_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_erangeflag_p'].apply(null, arguments);
  }

  function _mpfr_erf(
  ) {
  if (!Module['_mpfr_erf']) abort("external function 'mpfr_erf' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_erf'].apply(null, arguments);
  }

  function _mpfr_erfc(
  ) {
  if (!Module['_mpfr_erfc']) abort("external function 'mpfr_erfc' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_erfc'].apply(null, arguments);
  }

  function _mpfr_exp(
  ) {
  if (!Module['_mpfr_exp']) abort("external function 'mpfr_exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_exp'].apply(null, arguments);
  }

  function _mpfr_exp10(
  ) {
  if (!Module['_mpfr_exp10']) abort("external function 'mpfr_exp10' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_exp10'].apply(null, arguments);
  }

  function _mpfr_exp2(
  ) {
  if (!Module['_mpfr_exp2']) abort("external function 'mpfr_exp2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_exp2'].apply(null, arguments);
  }

  function _mpfr_expm1(
  ) {
  if (!Module['_mpfr_expm1']) abort("external function 'mpfr_expm1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_expm1'].apply(null, arguments);
  }

  function _mpfr_extract(
  ) {
  if (!Module['_mpfr_extract']) abort("external function 'mpfr_extract' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_extract'].apply(null, arguments);
  }

  function _mpfr_fac_ui(
  ) {
  if (!Module['_mpfr_fac_ui']) abort("external function 'mpfr_fac_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fac_ui'].apply(null, arguments);
  }

  function _mpfr_fits_intmax_p(
  ) {
  if (!Module['_mpfr_fits_intmax_p']) abort("external function 'mpfr_fits_intmax_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fits_intmax_p'].apply(null, arguments);
  }

  function _mpfr_fits_sint_p(
  ) {
  if (!Module['_mpfr_fits_sint_p']) abort("external function 'mpfr_fits_sint_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fits_sint_p'].apply(null, arguments);
  }

  function _mpfr_fits_slong_p(
  ) {
  if (!Module['_mpfr_fits_slong_p']) abort("external function 'mpfr_fits_slong_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fits_slong_p'].apply(null, arguments);
  }

  function _mpfr_fits_sshort_p(
  ) {
  if (!Module['_mpfr_fits_sshort_p']) abort("external function 'mpfr_fits_sshort_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fits_sshort_p'].apply(null, arguments);
  }

  function _mpfr_fits_uint_p(
  ) {
  if (!Module['_mpfr_fits_uint_p']) abort("external function 'mpfr_fits_uint_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fits_uint_p'].apply(null, arguments);
  }

  function _mpfr_fits_uintmax_p(
  ) {
  if (!Module['_mpfr_fits_uintmax_p']) abort("external function 'mpfr_fits_uintmax_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fits_uintmax_p'].apply(null, arguments);
  }

  function _mpfr_fits_ulong_p(
  ) {
  if (!Module['_mpfr_fits_ulong_p']) abort("external function 'mpfr_fits_ulong_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fits_ulong_p'].apply(null, arguments);
  }

  function _mpfr_fits_ushort_p(
  ) {
  if (!Module['_mpfr_fits_ushort_p']) abort("external function 'mpfr_fits_ushort_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fits_ushort_p'].apply(null, arguments);
  }

  function _mpfr_flags_clear(
  ) {
  if (!Module['_mpfr_flags_clear']) abort("external function 'mpfr_flags_clear' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_flags_clear'].apply(null, arguments);
  }

  function _mpfr_flags_restore(
  ) {
  if (!Module['_mpfr_flags_restore']) abort("external function 'mpfr_flags_restore' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_flags_restore'].apply(null, arguments);
  }

  function _mpfr_flags_save(
  ) {
  if (!Module['_mpfr_flags_save']) abort("external function 'mpfr_flags_save' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_flags_save'].apply(null, arguments);
  }

  function _mpfr_flags_set(
  ) {
  if (!Module['_mpfr_flags_set']) abort("external function 'mpfr_flags_set' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_flags_set'].apply(null, arguments);
  }

  function _mpfr_flags_test(
  ) {
  if (!Module['_mpfr_flags_test']) abort("external function 'mpfr_flags_test' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_flags_test'].apply(null, arguments);
  }

  function _mpfr_floor(
  ) {
  if (!Module['_mpfr_floor']) abort("external function 'mpfr_floor' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_floor'].apply(null, arguments);
  }

  function _mpfr_fma(
  ) {
  if (!Module['_mpfr_fma']) abort("external function 'mpfr_fma' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fma'].apply(null, arguments);
  }

  function _mpfr_fmma(
  ) {
  if (!Module['_mpfr_fmma']) abort("external function 'mpfr_fmma' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fmma'].apply(null, arguments);
  }

  function _mpfr_fmms(
  ) {
  if (!Module['_mpfr_fmms']) abort("external function 'mpfr_fmms' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fmms'].apply(null, arguments);
  }

  function _mpfr_fmod(
  ) {
  if (!Module['_mpfr_fmod']) abort("external function 'mpfr_fmod' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fmod'].apply(null, arguments);
  }

  function _mpfr_fmodquo(
  ) {
  if (!Module['_mpfr_fmodquo']) abort("external function 'mpfr_fmodquo' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fmodquo'].apply(null, arguments);
  }

  function _mpfr_fms(
  ) {
  if (!Module['_mpfr_fms']) abort("external function 'mpfr_fms' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_fms'].apply(null, arguments);
  }

  function _mpfr_frac(
  ) {
  if (!Module['_mpfr_frac']) abort("external function 'mpfr_frac' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_frac'].apply(null, arguments);
  }

  function _mpfr_free_cache(
  ) {
  if (!Module['_mpfr_free_cache']) abort("external function 'mpfr_free_cache' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_free_cache'].apply(null, arguments);
  }

  function _mpfr_free_cache2(
  ) {
  if (!Module['_mpfr_free_cache2']) abort("external function 'mpfr_free_cache2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_free_cache2'].apply(null, arguments);
  }

  function _mpfr_free_pool(
  ) {
  if (!Module['_mpfr_free_pool']) abort("external function 'mpfr_free_pool' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_free_pool'].apply(null, arguments);
  }

  function _mpfr_free_str(
  ) {
  if (!Module['_mpfr_free_str']) abort("external function 'mpfr_free_str' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_free_str'].apply(null, arguments);
  }

  function _mpfr_frexp(
  ) {
  if (!Module['_mpfr_frexp']) abort("external function 'mpfr_frexp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_frexp'].apply(null, arguments);
  }

  function _mpfr_gamma(
  ) {
  if (!Module['_mpfr_gamma']) abort("external function 'mpfr_gamma' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_gamma'].apply(null, arguments);
  }

  function _mpfr_gamma_inc(
  ) {
  if (!Module['_mpfr_gamma_inc']) abort("external function 'mpfr_gamma_inc' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_gamma_inc'].apply(null, arguments);
  }

  function _mpfr_get_d(
  ) {
  if (!Module['_mpfr_get_d']) abort("external function 'mpfr_get_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_d'].apply(null, arguments);
  }

  function _mpfr_get_d1(
  ) {
  if (!Module['_mpfr_get_d1']) abort("external function 'mpfr_get_d1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_d1'].apply(null, arguments);
  }

  function _mpfr_get_d_2exp(
  ) {
  if (!Module['_mpfr_get_d_2exp']) abort("external function 'mpfr_get_d_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_d_2exp'].apply(null, arguments);
  }

  function _mpfr_get_default_prec(
  ) {
  if (!Module['_mpfr_get_default_prec']) abort("external function 'mpfr_get_default_prec' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_default_prec'].apply(null, arguments);
  }

  function _mpfr_get_default_rounding_mode(
  ) {
  if (!Module['_mpfr_get_default_rounding_mode']) abort("external function 'mpfr_get_default_rounding_mode' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_default_rounding_mode'].apply(null, arguments);
  }

  function _mpfr_get_emax(
  ) {
  if (!Module['_mpfr_get_emax']) abort("external function 'mpfr_get_emax' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_emax'].apply(null, arguments);
  }

  function _mpfr_get_emax_max(
  ) {
  if (!Module['_mpfr_get_emax_max']) abort("external function 'mpfr_get_emax_max' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_emax_max'].apply(null, arguments);
  }

  function _mpfr_get_emax_min(
  ) {
  if (!Module['_mpfr_get_emax_min']) abort("external function 'mpfr_get_emax_min' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_emax_min'].apply(null, arguments);
  }

  function _mpfr_get_emin(
  ) {
  if (!Module['_mpfr_get_emin']) abort("external function 'mpfr_get_emin' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_emin'].apply(null, arguments);
  }

  function _mpfr_get_emin_max(
  ) {
  if (!Module['_mpfr_get_emin_max']) abort("external function 'mpfr_get_emin_max' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_emin_max'].apply(null, arguments);
  }

  function _mpfr_get_emin_min(
  ) {
  if (!Module['_mpfr_get_emin_min']) abort("external function 'mpfr_get_emin_min' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_emin_min'].apply(null, arguments);
  }

  function _mpfr_get_exp(
  ) {
  if (!Module['_mpfr_get_exp']) abort("external function 'mpfr_get_exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_exp'].apply(null, arguments);
  }

  function _mpfr_get_f(
  ) {
  if (!Module['_mpfr_get_f']) abort("external function 'mpfr_get_f' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_f'].apply(null, arguments);
  }

  function _mpfr_get_flt(
  ) {
  if (!Module['_mpfr_get_flt']) abort("external function 'mpfr_get_flt' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_flt'].apply(null, arguments);
  }

  function _mpfr_get_ld(
  ) {
  if (!Module['_mpfr_get_ld']) abort("external function 'mpfr_get_ld' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_ld'].apply(null, arguments);
  }

  function _mpfr_get_ld_2exp(
  ) {
  if (!Module['_mpfr_get_ld_2exp']) abort("external function 'mpfr_get_ld_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_ld_2exp'].apply(null, arguments);
  }

  function _mpfr_get_patches(
  ) {
  if (!Module['_mpfr_get_patches']) abort("external function 'mpfr_get_patches' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_patches'].apply(null, arguments);
  }

  function _mpfr_get_prec(
  ) {
  if (!Module['_mpfr_get_prec']) abort("external function 'mpfr_get_prec' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_prec'].apply(null, arguments);
  }

  function _mpfr_get_q(
  ) {
  if (!Module['_mpfr_get_q']) abort("external function 'mpfr_get_q' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_q'].apply(null, arguments);
  }

  function _mpfr_get_si(
  ) {
  if (!Module['_mpfr_get_si']) abort("external function 'mpfr_get_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_si'].apply(null, arguments);
  }

  function _mpfr_get_str(
  ) {
  if (!Module['_mpfr_get_str']) abort("external function 'mpfr_get_str' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_str'].apply(null, arguments);
  }

  function _mpfr_get_ui(
  ) {
  if (!Module['_mpfr_get_ui']) abort("external function 'mpfr_get_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_ui'].apply(null, arguments);
  }

  function _mpfr_get_version(
  ) {
  if (!Module['_mpfr_get_version']) abort("external function 'mpfr_get_version' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_version'].apply(null, arguments);
  }

  function _mpfr_get_z(
  ) {
  if (!Module['_mpfr_get_z']) abort("external function 'mpfr_get_z' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_z'].apply(null, arguments);
  }

  function _mpfr_get_z_2exp(
  ) {
  if (!Module['_mpfr_get_z_2exp']) abort("external function 'mpfr_get_z_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_get_z_2exp'].apply(null, arguments);
  }

  function _mpfr_grandom(
  ) {
  if (!Module['_mpfr_grandom']) abort("external function 'mpfr_grandom' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_grandom'].apply(null, arguments);
  }

  function _mpfr_greater_p(
  ) {
  if (!Module['_mpfr_greater_p']) abort("external function 'mpfr_greater_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_greater_p'].apply(null, arguments);
  }

  function _mpfr_greaterequal_p(
  ) {
  if (!Module['_mpfr_greaterequal_p']) abort("external function 'mpfr_greaterequal_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_greaterequal_p'].apply(null, arguments);
  }

  function _mpfr_hypot(
  ) {
  if (!Module['_mpfr_hypot']) abort("external function 'mpfr_hypot' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_hypot'].apply(null, arguments);
  }

  function _mpfr_inexflag_p(
  ) {
  if (!Module['_mpfr_inexflag_p']) abort("external function 'mpfr_inexflag_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_inexflag_p'].apply(null, arguments);
  }

  function _mpfr_inf_p(
  ) {
  if (!Module['_mpfr_inf_p']) abort("external function 'mpfr_inf_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_inf_p'].apply(null, arguments);
  }

  function _mpfr_init(
  ) {
  if (!Module['_mpfr_init']) abort("external function 'mpfr_init' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_init'].apply(null, arguments);
  }

  function _mpfr_init2(
  ) {
  if (!Module['_mpfr_init2']) abort("external function 'mpfr_init2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_init2'].apply(null, arguments);
  }

  function _mpfr_init_set_str(
  ) {
  if (!Module['_mpfr_init_set_str']) abort("external function 'mpfr_init_set_str' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_init_set_str'].apply(null, arguments);
  }

  function _mpfr_inits(
  ) {
  if (!Module['_mpfr_inits']) abort("external function 'mpfr_inits' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_inits'].apply(null, arguments);
  }

  function _mpfr_inits2(
  ) {
  if (!Module['_mpfr_inits2']) abort("external function 'mpfr_inits2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_inits2'].apply(null, arguments);
  }

  function _mpfr_integer_p(
  ) {
  if (!Module['_mpfr_integer_p']) abort("external function 'mpfr_integer_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_integer_p'].apply(null, arguments);
  }

  function _mpfr_j0(
  ) {
  if (!Module['_mpfr_j0']) abort("external function 'mpfr_j0' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_j0'].apply(null, arguments);
  }

  function _mpfr_j1(
  ) {
  if (!Module['_mpfr_j1']) abort("external function 'mpfr_j1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_j1'].apply(null, arguments);
  }

  function _mpfr_jn(
  ) {
  if (!Module['_mpfr_jn']) abort("external function 'mpfr_jn' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_jn'].apply(null, arguments);
  }

  function _mpfr_less_p(
  ) {
  if (!Module['_mpfr_less_p']) abort("external function 'mpfr_less_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_less_p'].apply(null, arguments);
  }

  function _mpfr_lessequal_p(
  ) {
  if (!Module['_mpfr_lessequal_p']) abort("external function 'mpfr_lessequal_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_lessequal_p'].apply(null, arguments);
  }

  function _mpfr_lessgreater_p(
  ) {
  if (!Module['_mpfr_lessgreater_p']) abort("external function 'mpfr_lessgreater_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_lessgreater_p'].apply(null, arguments);
  }

  function _mpfr_lgamma(
  ) {
  if (!Module['_mpfr_lgamma']) abort("external function 'mpfr_lgamma' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_lgamma'].apply(null, arguments);
  }

  function _mpfr_li2(
  ) {
  if (!Module['_mpfr_li2']) abort("external function 'mpfr_li2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_li2'].apply(null, arguments);
  }

  function _mpfr_lngamma(
  ) {
  if (!Module['_mpfr_lngamma']) abort("external function 'mpfr_lngamma' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_lngamma'].apply(null, arguments);
  }

  function _mpfr_log(
  ) {
  if (!Module['_mpfr_log']) abort("external function 'mpfr_log' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_log'].apply(null, arguments);
  }

  function _mpfr_log10(
  ) {
  if (!Module['_mpfr_log10']) abort("external function 'mpfr_log10' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_log10'].apply(null, arguments);
  }

  function _mpfr_log1p(
  ) {
  if (!Module['_mpfr_log1p']) abort("external function 'mpfr_log1p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_log1p'].apply(null, arguments);
  }

  function _mpfr_log2(
  ) {
  if (!Module['_mpfr_log2']) abort("external function 'mpfr_log2' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_log2'].apply(null, arguments);
  }

  function _mpfr_log_ui(
  ) {
  if (!Module['_mpfr_log_ui']) abort("external function 'mpfr_log_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_log_ui'].apply(null, arguments);
  }

  function _mpfr_max(
  ) {
  if (!Module['_mpfr_max']) abort("external function 'mpfr_max' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_max'].apply(null, arguments);
  }

  function _mpfr_min(
  ) {
  if (!Module['_mpfr_min']) abort("external function 'mpfr_min' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_min'].apply(null, arguments);
  }

  function _mpfr_min_prec(
  ) {
  if (!Module['_mpfr_min_prec']) abort("external function 'mpfr_min_prec' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_min_prec'].apply(null, arguments);
  }

  function _mpfr_modf(
  ) {
  if (!Module['_mpfr_modf']) abort("external function 'mpfr_modf' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_modf'].apply(null, arguments);
  }

  function _mpfr_mp_memory_cleanup(
  ) {
  if (!Module['_mpfr_mp_memory_cleanup']) abort("external function 'mpfr_mp_memory_cleanup' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_mp_memory_cleanup'].apply(null, arguments);
  }

  function _mpfr_mul(
  ) {
  if (!Module['_mpfr_mul']) abort("external function 'mpfr_mul' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_mul'].apply(null, arguments);
  }

  function _mpfr_mul_2exp(
  ) {
  if (!Module['_mpfr_mul_2exp']) abort("external function 'mpfr_mul_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_mul_2exp'].apply(null, arguments);
  }

  function _mpfr_mul_2si(
  ) {
  if (!Module['_mpfr_mul_2si']) abort("external function 'mpfr_mul_2si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_mul_2si'].apply(null, arguments);
  }

  function _mpfr_mul_2ui(
  ) {
  if (!Module['_mpfr_mul_2ui']) abort("external function 'mpfr_mul_2ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_mul_2ui'].apply(null, arguments);
  }

  function _mpfr_mul_d(
  ) {
  if (!Module['_mpfr_mul_d']) abort("external function 'mpfr_mul_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_mul_d'].apply(null, arguments);
  }

  function _mpfr_mul_q(
  ) {
  if (!Module['_mpfr_mul_q']) abort("external function 'mpfr_mul_q' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_mul_q'].apply(null, arguments);
  }

  function _mpfr_mul_si(
  ) {
  if (!Module['_mpfr_mul_si']) abort("external function 'mpfr_mul_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_mul_si'].apply(null, arguments);
  }

  function _mpfr_mul_ui(
  ) {
  if (!Module['_mpfr_mul_ui']) abort("external function 'mpfr_mul_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_mul_ui'].apply(null, arguments);
  }

  function _mpfr_mul_z(
  ) {
  if (!Module['_mpfr_mul_z']) abort("external function 'mpfr_mul_z' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_mul_z'].apply(null, arguments);
  }

  function _mpfr_nan_p(
  ) {
  if (!Module['_mpfr_nan_p']) abort("external function 'mpfr_nan_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_nan_p'].apply(null, arguments);
  }

  function _mpfr_nanflag_p(
  ) {
  if (!Module['_mpfr_nanflag_p']) abort("external function 'mpfr_nanflag_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_nanflag_p'].apply(null, arguments);
  }

  function _mpfr_neg(
  ) {
  if (!Module['_mpfr_neg']) abort("external function 'mpfr_neg' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_neg'].apply(null, arguments);
  }

  function _mpfr_nextabove(
  ) {
  if (!Module['_mpfr_nextabove']) abort("external function 'mpfr_nextabove' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_nextabove'].apply(null, arguments);
  }

  function _mpfr_nextbelow(
  ) {
  if (!Module['_mpfr_nextbelow']) abort("external function 'mpfr_nextbelow' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_nextbelow'].apply(null, arguments);
  }

  function _mpfr_nexttoward(
  ) {
  if (!Module['_mpfr_nexttoward']) abort("external function 'mpfr_nexttoward' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_nexttoward'].apply(null, arguments);
  }

  function _mpfr_nrandom(
  ) {
  if (!Module['_mpfr_nrandom']) abort("external function 'mpfr_nrandom' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_nrandom'].apply(null, arguments);
  }

  function _mpfr_number_p(
  ) {
  if (!Module['_mpfr_number_p']) abort("external function 'mpfr_number_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_number_p'].apply(null, arguments);
  }

  function _mpfr_overflow_p(
  ) {
  if (!Module['_mpfr_overflow_p']) abort("external function 'mpfr_overflow_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_overflow_p'].apply(null, arguments);
  }

  function _mpfr_pow(
  ) {
  if (!Module['_mpfr_pow']) abort("external function 'mpfr_pow' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_pow'].apply(null, arguments);
  }

  function _mpfr_pow_si(
  ) {
  if (!Module['_mpfr_pow_si']) abort("external function 'mpfr_pow_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_pow_si'].apply(null, arguments);
  }

  function _mpfr_pow_ui(
  ) {
  if (!Module['_mpfr_pow_ui']) abort("external function 'mpfr_pow_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_pow_ui'].apply(null, arguments);
  }

  function _mpfr_pow_z(
  ) {
  if (!Module['_mpfr_pow_z']) abort("external function 'mpfr_pow_z' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_pow_z'].apply(null, arguments);
  }

  function _mpfr_prec_round(
  ) {
  if (!Module['_mpfr_prec_round']) abort("external function 'mpfr_prec_round' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_prec_round'].apply(null, arguments);
  }

  function _mpfr_print_rnd_mode(
  ) {
  if (!Module['_mpfr_print_rnd_mode']) abort("external function 'mpfr_print_rnd_mode' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_print_rnd_mode'].apply(null, arguments);
  }

  function _mpfr_printf(
  ) {
  if (!Module['_mpfr_printf']) abort("external function 'mpfr_printf' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_printf'].apply(null, arguments);
  }

  function _mpfr_rec_sqrt(
  ) {
  if (!Module['_mpfr_rec_sqrt']) abort("external function 'mpfr_rec_sqrt' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_rec_sqrt'].apply(null, arguments);
  }

  function _mpfr_regular_p(
  ) {
  if (!Module['_mpfr_regular_p']) abort("external function 'mpfr_regular_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_regular_p'].apply(null, arguments);
  }

  function _mpfr_reldiff(
  ) {
  if (!Module['_mpfr_reldiff']) abort("external function 'mpfr_reldiff' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_reldiff'].apply(null, arguments);
  }

  function _mpfr_remainder(
  ) {
  if (!Module['_mpfr_remainder']) abort("external function 'mpfr_remainder' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_remainder'].apply(null, arguments);
  }

  function _mpfr_remquo(
  ) {
  if (!Module['_mpfr_remquo']) abort("external function 'mpfr_remquo' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_remquo'].apply(null, arguments);
  }

  function _mpfr_rint(
  ) {
  if (!Module['_mpfr_rint']) abort("external function 'mpfr_rint' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_rint'].apply(null, arguments);
  }

  function _mpfr_rint_ceil(
  ) {
  if (!Module['_mpfr_rint_ceil']) abort("external function 'mpfr_rint_ceil' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_rint_ceil'].apply(null, arguments);
  }

  function _mpfr_rint_floor(
  ) {
  if (!Module['_mpfr_rint_floor']) abort("external function 'mpfr_rint_floor' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_rint_floor'].apply(null, arguments);
  }

  function _mpfr_rint_round(
  ) {
  if (!Module['_mpfr_rint_round']) abort("external function 'mpfr_rint_round' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_rint_round'].apply(null, arguments);
  }

  function _mpfr_rint_roundeven(
  ) {
  if (!Module['_mpfr_rint_roundeven']) abort("external function 'mpfr_rint_roundeven' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_rint_roundeven'].apply(null, arguments);
  }

  function _mpfr_rint_trunc(
  ) {
  if (!Module['_mpfr_rint_trunc']) abort("external function 'mpfr_rint_trunc' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_rint_trunc'].apply(null, arguments);
  }

  function _mpfr_root(
  ) {
  if (!Module['_mpfr_root']) abort("external function 'mpfr_root' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_root'].apply(null, arguments);
  }

  function _mpfr_rootn_ui(
  ) {
  if (!Module['_mpfr_rootn_ui']) abort("external function 'mpfr_rootn_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_rootn_ui'].apply(null, arguments);
  }

  function _mpfr_round(
  ) {
  if (!Module['_mpfr_round']) abort("external function 'mpfr_round' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_round'].apply(null, arguments);
  }

  function _mpfr_round_nearest_away_begin(
  ) {
  if (!Module['_mpfr_round_nearest_away_begin']) abort("external function 'mpfr_round_nearest_away_begin' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_round_nearest_away_begin'].apply(null, arguments);
  }

  function _mpfr_round_nearest_away_end(
  ) {
  if (!Module['_mpfr_round_nearest_away_end']) abort("external function 'mpfr_round_nearest_away_end' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_round_nearest_away_end'].apply(null, arguments);
  }

  function _mpfr_roundeven(
  ) {
  if (!Module['_mpfr_roundeven']) abort("external function 'mpfr_roundeven' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_roundeven'].apply(null, arguments);
  }

  function _mpfr_sec(
  ) {
  if (!Module['_mpfr_sec']) abort("external function 'mpfr_sec' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sec'].apply(null, arguments);
  }

  function _mpfr_sech(
  ) {
  if (!Module['_mpfr_sech']) abort("external function 'mpfr_sech' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sech'].apply(null, arguments);
  }

  function _mpfr_set(
  ) {
  if (!Module['_mpfr_set']) abort("external function 'mpfr_set' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set'].apply(null, arguments);
  }

  function _mpfr_set4(
  ) {
  if (!Module['_mpfr_set4']) abort("external function 'mpfr_set4' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set4'].apply(null, arguments);
  }

  function _mpfr_set_d(
  ) {
  if (!Module['_mpfr_set_d']) abort("external function 'mpfr_set_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_d'].apply(null, arguments);
  }

  function _mpfr_set_default_prec(
  ) {
  if (!Module['_mpfr_set_default_prec']) abort("external function 'mpfr_set_default_prec' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_default_prec'].apply(null, arguments);
  }

  function _mpfr_set_default_rounding_mode(
  ) {
  if (!Module['_mpfr_set_default_rounding_mode']) abort("external function 'mpfr_set_default_rounding_mode' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_default_rounding_mode'].apply(null, arguments);
  }

  function _mpfr_set_divby0(
  ) {
  if (!Module['_mpfr_set_divby0']) abort("external function 'mpfr_set_divby0' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_divby0'].apply(null, arguments);
  }

  function _mpfr_set_emax(
  ) {
  if (!Module['_mpfr_set_emax']) abort("external function 'mpfr_set_emax' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_emax'].apply(null, arguments);
  }

  function _mpfr_set_emin(
  ) {
  if (!Module['_mpfr_set_emin']) abort("external function 'mpfr_set_emin' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_emin'].apply(null, arguments);
  }

  function _mpfr_set_erangeflag(
  ) {
  if (!Module['_mpfr_set_erangeflag']) abort("external function 'mpfr_set_erangeflag' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_erangeflag'].apply(null, arguments);
  }

  function _mpfr_set_exp(
  ) {
  if (!Module['_mpfr_set_exp']) abort("external function 'mpfr_set_exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_exp'].apply(null, arguments);
  }

  function _mpfr_set_f(
  ) {
  if (!Module['_mpfr_set_f']) abort("external function 'mpfr_set_f' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_f'].apply(null, arguments);
  }

  function _mpfr_set_flt(
  ) {
  if (!Module['_mpfr_set_flt']) abort("external function 'mpfr_set_flt' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_flt'].apply(null, arguments);
  }

  function _mpfr_set_inexflag(
  ) {
  if (!Module['_mpfr_set_inexflag']) abort("external function 'mpfr_set_inexflag' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_inexflag'].apply(null, arguments);
  }

  function _mpfr_set_inf(
  ) {
  if (!Module['_mpfr_set_inf']) abort("external function 'mpfr_set_inf' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_inf'].apply(null, arguments);
  }

  function _mpfr_set_ld(
  ) {
  if (!Module['_mpfr_set_ld']) abort("external function 'mpfr_set_ld' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_ld'].apply(null, arguments);
  }

  function _mpfr_set_nan(
  ) {
  if (!Module['_mpfr_set_nan']) abort("external function 'mpfr_set_nan' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_nan'].apply(null, arguments);
  }

  function _mpfr_set_nanflag(
  ) {
  if (!Module['_mpfr_set_nanflag']) abort("external function 'mpfr_set_nanflag' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_nanflag'].apply(null, arguments);
  }

  function _mpfr_set_overflow(
  ) {
  if (!Module['_mpfr_set_overflow']) abort("external function 'mpfr_set_overflow' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_overflow'].apply(null, arguments);
  }

  function _mpfr_set_prec(
  ) {
  if (!Module['_mpfr_set_prec']) abort("external function 'mpfr_set_prec' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_prec'].apply(null, arguments);
  }

  function _mpfr_set_prec_raw(
  ) {
  if (!Module['_mpfr_set_prec_raw']) abort("external function 'mpfr_set_prec_raw' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_prec_raw'].apply(null, arguments);
  }

  function _mpfr_set_q(
  ) {
  if (!Module['_mpfr_set_q']) abort("external function 'mpfr_set_q' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_q'].apply(null, arguments);
  }

  function _mpfr_set_si(
  ) {
  if (!Module['_mpfr_set_si']) abort("external function 'mpfr_set_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_si'].apply(null, arguments);
  }

  function _mpfr_set_si_2exp(
  ) {
  if (!Module['_mpfr_set_si_2exp']) abort("external function 'mpfr_set_si_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_si_2exp'].apply(null, arguments);
  }

  function _mpfr_set_str(
  ) {
  if (!Module['_mpfr_set_str']) abort("external function 'mpfr_set_str' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_str'].apply(null, arguments);
  }

  function _mpfr_set_ui(
  ) {
  if (!Module['_mpfr_set_ui']) abort("external function 'mpfr_set_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_ui'].apply(null, arguments);
  }

  function _mpfr_set_ui_2exp(
  ) {
  if (!Module['_mpfr_set_ui_2exp']) abort("external function 'mpfr_set_ui_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_ui_2exp'].apply(null, arguments);
  }

  function _mpfr_set_underflow(
  ) {
  if (!Module['_mpfr_set_underflow']) abort("external function 'mpfr_set_underflow' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_underflow'].apply(null, arguments);
  }

  function _mpfr_set_z(
  ) {
  if (!Module['_mpfr_set_z']) abort("external function 'mpfr_set_z' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_z'].apply(null, arguments);
  }

  function _mpfr_set_z_2exp(
  ) {
  if (!Module['_mpfr_set_z_2exp']) abort("external function 'mpfr_set_z_2exp' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_z_2exp'].apply(null, arguments);
  }

  function _mpfr_set_zero(
  ) {
  if (!Module['_mpfr_set_zero']) abort("external function 'mpfr_set_zero' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_set_zero'].apply(null, arguments);
  }

  function _mpfr_setsign(
  ) {
  if (!Module['_mpfr_setsign']) abort("external function 'mpfr_setsign' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_setsign'].apply(null, arguments);
  }

  function _mpfr_sgn(
  ) {
  if (!Module['_mpfr_sgn']) abort("external function 'mpfr_sgn' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sgn'].apply(null, arguments);
  }

  function _mpfr_si_div(
  ) {
  if (!Module['_mpfr_si_div']) abort("external function 'mpfr_si_div' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_si_div'].apply(null, arguments);
  }

  function _mpfr_si_sub(
  ) {
  if (!Module['_mpfr_si_sub']) abort("external function 'mpfr_si_sub' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_si_sub'].apply(null, arguments);
  }

  function _mpfr_signbit(
  ) {
  if (!Module['_mpfr_signbit']) abort("external function 'mpfr_signbit' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_signbit'].apply(null, arguments);
  }

  function _mpfr_sin(
  ) {
  if (!Module['_mpfr_sin']) abort("external function 'mpfr_sin' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sin'].apply(null, arguments);
  }

  function _mpfr_sin_cos(
  ) {
  if (!Module['_mpfr_sin_cos']) abort("external function 'mpfr_sin_cos' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sin_cos'].apply(null, arguments);
  }

  function _mpfr_sinh(
  ) {
  if (!Module['_mpfr_sinh']) abort("external function 'mpfr_sinh' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sinh'].apply(null, arguments);
  }

  function _mpfr_sinh_cosh(
  ) {
  if (!Module['_mpfr_sinh_cosh']) abort("external function 'mpfr_sinh_cosh' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sinh_cosh'].apply(null, arguments);
  }

  function _mpfr_snprintf(
  ) {
  if (!Module['_mpfr_snprintf']) abort("external function 'mpfr_snprintf' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_snprintf'].apply(null, arguments);
  }

  function _mpfr_sprintf(
  ) {
  if (!Module['_mpfr_sprintf']) abort("external function 'mpfr_sprintf' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sprintf'].apply(null, arguments);
  }

  function _mpfr_sqr(
  ) {
  if (!Module['_mpfr_sqr']) abort("external function 'mpfr_sqr' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sqr'].apply(null, arguments);
  }

  function _mpfr_sqrt(
  ) {
  if (!Module['_mpfr_sqrt']) abort("external function 'mpfr_sqrt' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sqrt'].apply(null, arguments);
  }

  function _mpfr_sqrt_ui(
  ) {
  if (!Module['_mpfr_sqrt_ui']) abort("external function 'mpfr_sqrt_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sqrt_ui'].apply(null, arguments);
  }

  function _mpfr_strtofr(
  ) {
  if (!Module['_mpfr_strtofr']) abort("external function 'mpfr_strtofr' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_strtofr'].apply(null, arguments);
  }

  function _mpfr_sub(
  ) {
  if (!Module['_mpfr_sub']) abort("external function 'mpfr_sub' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sub'].apply(null, arguments);
  }

  function _mpfr_sub_d(
  ) {
  if (!Module['_mpfr_sub_d']) abort("external function 'mpfr_sub_d' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sub_d'].apply(null, arguments);
  }

  function _mpfr_sub_q(
  ) {
  if (!Module['_mpfr_sub_q']) abort("external function 'mpfr_sub_q' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sub_q'].apply(null, arguments);
  }

  function _mpfr_sub_si(
  ) {
  if (!Module['_mpfr_sub_si']) abort("external function 'mpfr_sub_si' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sub_si'].apply(null, arguments);
  }

  function _mpfr_sub_ui(
  ) {
  if (!Module['_mpfr_sub_ui']) abort("external function 'mpfr_sub_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sub_ui'].apply(null, arguments);
  }

  function _mpfr_sub_z(
  ) {
  if (!Module['_mpfr_sub_z']) abort("external function 'mpfr_sub_z' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sub_z'].apply(null, arguments);
  }

  function _mpfr_subnormalize(
  ) {
  if (!Module['_mpfr_subnormalize']) abort("external function 'mpfr_subnormalize' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_subnormalize'].apply(null, arguments);
  }

  function _mpfr_sum(
  ) {
  if (!Module['_mpfr_sum']) abort("external function 'mpfr_sum' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_sum'].apply(null, arguments);
  }

  function _mpfr_swap(
  ) {
  if (!Module['_mpfr_swap']) abort("external function 'mpfr_swap' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_swap'].apply(null, arguments);
  }

  function _mpfr_tan(
  ) {
  if (!Module['_mpfr_tan']) abort("external function 'mpfr_tan' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_tan'].apply(null, arguments);
  }

  function _mpfr_tanh(
  ) {
  if (!Module['_mpfr_tanh']) abort("external function 'mpfr_tanh' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_tanh'].apply(null, arguments);
  }

  function _mpfr_trunc(
  ) {
  if (!Module['_mpfr_trunc']) abort("external function 'mpfr_trunc' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_trunc'].apply(null, arguments);
  }

  function _mpfr_ui_div(
  ) {
  if (!Module['_mpfr_ui_div']) abort("external function 'mpfr_ui_div' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_ui_div'].apply(null, arguments);
  }

  function _mpfr_ui_pow(
  ) {
  if (!Module['_mpfr_ui_pow']) abort("external function 'mpfr_ui_pow' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_ui_pow'].apply(null, arguments);
  }

  function _mpfr_ui_pow_ui(
  ) {
  if (!Module['_mpfr_ui_pow_ui']) abort("external function 'mpfr_ui_pow_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_ui_pow_ui'].apply(null, arguments);
  }

  function _mpfr_ui_sub(
  ) {
  if (!Module['_mpfr_ui_sub']) abort("external function 'mpfr_ui_sub' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_ui_sub'].apply(null, arguments);
  }

  function _mpfr_underflow_p(
  ) {
  if (!Module['_mpfr_underflow_p']) abort("external function 'mpfr_underflow_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_underflow_p'].apply(null, arguments);
  }

  function _mpfr_unordered_p(
  ) {
  if (!Module['_mpfr_unordered_p']) abort("external function 'mpfr_unordered_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_unordered_p'].apply(null, arguments);
  }

  function _mpfr_urandom(
  ) {
  if (!Module['_mpfr_urandom']) abort("external function 'mpfr_urandom' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_urandom'].apply(null, arguments);
  }

  function _mpfr_urandomb(
  ) {
  if (!Module['_mpfr_urandomb']) abort("external function 'mpfr_urandomb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_urandomb'].apply(null, arguments);
  }

  function _mpfr_y0(
  ) {
  if (!Module['_mpfr_y0']) abort("external function 'mpfr_y0' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_y0'].apply(null, arguments);
  }

  function _mpfr_y1(
  ) {
  if (!Module['_mpfr_y1']) abort("external function 'mpfr_y1' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_y1'].apply(null, arguments);
  }

  function _mpfr_yn(
  ) {
  if (!Module['_mpfr_yn']) abort("external function 'mpfr_yn' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_yn'].apply(null, arguments);
  }

  function _mpfr_z_sub(
  ) {
  if (!Module['_mpfr_z_sub']) abort("external function 'mpfr_z_sub' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_z_sub'].apply(null, arguments);
  }

  function _mpfr_zero_p(
  ) {
  if (!Module['_mpfr_zero_p']) abort("external function 'mpfr_zero_p' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_zero_p'].apply(null, arguments);
  }

  function _mpfr_zeta(
  ) {
  if (!Module['_mpfr_zeta']) abort("external function 'mpfr_zeta' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_zeta'].apply(null, arguments);
  }

  function _mpfr_zeta_ui(
  ) {
  if (!Module['_mpfr_zeta_ui']) abort("external function 'mpfr_zeta_ui' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_mpfr_zeta_ui'].apply(null, arguments);
  }

  function _pcre2_code_copy_16(
  ) {
  if (!Module['_pcre2_code_copy_16']) abort("external function 'pcre2_code_copy_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_code_copy_16'].apply(null, arguments);
  }

  function _pcre2_code_copy_32(
  ) {
  if (!Module['_pcre2_code_copy_32']) abort("external function 'pcre2_code_copy_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_code_copy_32'].apply(null, arguments);
  }

  function _pcre2_code_copy_8(
  ) {
  if (!Module['_pcre2_code_copy_8']) abort("external function 'pcre2_code_copy_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_code_copy_8'].apply(null, arguments);
  }

  function _pcre2_code_copy_with_tables_16(
  ) {
  if (!Module['_pcre2_code_copy_with_tables_16']) abort("external function 'pcre2_code_copy_with_tables_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_code_copy_with_tables_16'].apply(null, arguments);
  }

  function _pcre2_code_copy_with_tables_32(
  ) {
  if (!Module['_pcre2_code_copy_with_tables_32']) abort("external function 'pcre2_code_copy_with_tables_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_code_copy_with_tables_32'].apply(null, arguments);
  }

  function _pcre2_code_copy_with_tables_8(
  ) {
  if (!Module['_pcre2_code_copy_with_tables_8']) abort("external function 'pcre2_code_copy_with_tables_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_code_copy_with_tables_8'].apply(null, arguments);
  }

  function _pcre2_code_free_16(
  ) {
  if (!Module['_pcre2_code_free_16']) abort("external function 'pcre2_code_free_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_code_free_16'].apply(null, arguments);
  }

  function _pcre2_code_free_32(
  ) {
  if (!Module['_pcre2_code_free_32']) abort("external function 'pcre2_code_free_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_code_free_32'].apply(null, arguments);
  }

  function _pcre2_code_free_8(
  ) {
  if (!Module['_pcre2_code_free_8']) abort("external function 'pcre2_code_free_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_code_free_8'].apply(null, arguments);
  }

  function _pcre2_compile_16(
  ) {
  if (!Module['_pcre2_compile_16']) abort("external function 'pcre2_compile_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_compile_16'].apply(null, arguments);
  }

  function _pcre2_compile_32(
  ) {
  if (!Module['_pcre2_compile_32']) abort("external function 'pcre2_compile_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_compile_32'].apply(null, arguments);
  }

  function _pcre2_compile_8(
  ) {
  if (!Module['_pcre2_compile_8']) abort("external function 'pcre2_compile_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_compile_8'].apply(null, arguments);
  }

  function _pcre2_compile_context_copy_16(
  ) {
  if (!Module['_pcre2_compile_context_copy_16']) abort("external function 'pcre2_compile_context_copy_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_compile_context_copy_16'].apply(null, arguments);
  }

  function _pcre2_compile_context_copy_32(
  ) {
  if (!Module['_pcre2_compile_context_copy_32']) abort("external function 'pcre2_compile_context_copy_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_compile_context_copy_32'].apply(null, arguments);
  }

  function _pcre2_compile_context_copy_8(
  ) {
  if (!Module['_pcre2_compile_context_copy_8']) abort("external function 'pcre2_compile_context_copy_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_compile_context_copy_8'].apply(null, arguments);
  }

  function _pcre2_compile_context_create_16(
  ) {
  if (!Module['_pcre2_compile_context_create_16']) abort("external function 'pcre2_compile_context_create_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_compile_context_create_16'].apply(null, arguments);
  }

  function _pcre2_compile_context_create_32(
  ) {
  if (!Module['_pcre2_compile_context_create_32']) abort("external function 'pcre2_compile_context_create_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_compile_context_create_32'].apply(null, arguments);
  }

  function _pcre2_compile_context_create_8(
  ) {
  if (!Module['_pcre2_compile_context_create_8']) abort("external function 'pcre2_compile_context_create_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_compile_context_create_8'].apply(null, arguments);
  }

  function _pcre2_compile_context_free_16(
  ) {
  if (!Module['_pcre2_compile_context_free_16']) abort("external function 'pcre2_compile_context_free_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_compile_context_free_16'].apply(null, arguments);
  }

  function _pcre2_compile_context_free_32(
  ) {
  if (!Module['_pcre2_compile_context_free_32']) abort("external function 'pcre2_compile_context_free_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_compile_context_free_32'].apply(null, arguments);
  }

  function _pcre2_compile_context_free_8(
  ) {
  if (!Module['_pcre2_compile_context_free_8']) abort("external function 'pcre2_compile_context_free_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_compile_context_free_8'].apply(null, arguments);
  }

  function _pcre2_config_16(
  ) {
  if (!Module['_pcre2_config_16']) abort("external function 'pcre2_config_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_config_16'].apply(null, arguments);
  }

  function _pcre2_config_32(
  ) {
  if (!Module['_pcre2_config_32']) abort("external function 'pcre2_config_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_config_32'].apply(null, arguments);
  }

  function _pcre2_config_8(
  ) {
  if (!Module['_pcre2_config_8']) abort("external function 'pcre2_config_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_config_8'].apply(null, arguments);
  }

  function _pcre2_convert_context_copy_16(
  ) {
  if (!Module['_pcre2_convert_context_copy_16']) abort("external function 'pcre2_convert_context_copy_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_convert_context_copy_16'].apply(null, arguments);
  }

  function _pcre2_convert_context_copy_32(
  ) {
  if (!Module['_pcre2_convert_context_copy_32']) abort("external function 'pcre2_convert_context_copy_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_convert_context_copy_32'].apply(null, arguments);
  }

  function _pcre2_convert_context_copy_8(
  ) {
  if (!Module['_pcre2_convert_context_copy_8']) abort("external function 'pcre2_convert_context_copy_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_convert_context_copy_8'].apply(null, arguments);
  }

  function _pcre2_convert_context_create_16(
  ) {
  if (!Module['_pcre2_convert_context_create_16']) abort("external function 'pcre2_convert_context_create_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_convert_context_create_16'].apply(null, arguments);
  }

  function _pcre2_convert_context_create_32(
  ) {
  if (!Module['_pcre2_convert_context_create_32']) abort("external function 'pcre2_convert_context_create_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_convert_context_create_32'].apply(null, arguments);
  }

  function _pcre2_convert_context_create_8(
  ) {
  if (!Module['_pcre2_convert_context_create_8']) abort("external function 'pcre2_convert_context_create_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_convert_context_create_8'].apply(null, arguments);
  }

  function _pcre2_convert_context_free_16(
  ) {
  if (!Module['_pcre2_convert_context_free_16']) abort("external function 'pcre2_convert_context_free_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_convert_context_free_16'].apply(null, arguments);
  }

  function _pcre2_convert_context_free_32(
  ) {
  if (!Module['_pcre2_convert_context_free_32']) abort("external function 'pcre2_convert_context_free_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_convert_context_free_32'].apply(null, arguments);
  }

  function _pcre2_convert_context_free_8(
  ) {
  if (!Module['_pcre2_convert_context_free_8']) abort("external function 'pcre2_convert_context_free_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_convert_context_free_8'].apply(null, arguments);
  }

  function _pcre2_converted_pattern_free_16(
  ) {
  if (!Module['_pcre2_converted_pattern_free_16']) abort("external function 'pcre2_converted_pattern_free_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_converted_pattern_free_16'].apply(null, arguments);
  }

  function _pcre2_converted_pattern_free_32(
  ) {
  if (!Module['_pcre2_converted_pattern_free_32']) abort("external function 'pcre2_converted_pattern_free_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_converted_pattern_free_32'].apply(null, arguments);
  }

  function _pcre2_converted_pattern_free_8(
  ) {
  if (!Module['_pcre2_converted_pattern_free_8']) abort("external function 'pcre2_converted_pattern_free_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_converted_pattern_free_8'].apply(null, arguments);
  }

  function _pcre2_dfa_match_16(
  ) {
  if (!Module['_pcre2_dfa_match_16']) abort("external function 'pcre2_dfa_match_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_dfa_match_16'].apply(null, arguments);
  }

  function _pcre2_dfa_match_32(
  ) {
  if (!Module['_pcre2_dfa_match_32']) abort("external function 'pcre2_dfa_match_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_dfa_match_32'].apply(null, arguments);
  }

  function _pcre2_dfa_match_8(
  ) {
  if (!Module['_pcre2_dfa_match_8']) abort("external function 'pcre2_dfa_match_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_dfa_match_8'].apply(null, arguments);
  }

  function _pcre2_general_context_copy_16(
  ) {
  if (!Module['_pcre2_general_context_copy_16']) abort("external function 'pcre2_general_context_copy_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_general_context_copy_16'].apply(null, arguments);
  }

  function _pcre2_general_context_copy_32(
  ) {
  if (!Module['_pcre2_general_context_copy_32']) abort("external function 'pcre2_general_context_copy_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_general_context_copy_32'].apply(null, arguments);
  }

  function _pcre2_general_context_copy_8(
  ) {
  if (!Module['_pcre2_general_context_copy_8']) abort("external function 'pcre2_general_context_copy_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_general_context_copy_8'].apply(null, arguments);
  }

  function _pcre2_general_context_create_16(
  ) {
  if (!Module['_pcre2_general_context_create_16']) abort("external function 'pcre2_general_context_create_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_general_context_create_16'].apply(null, arguments);
  }

  function _pcre2_general_context_create_32(
  ) {
  if (!Module['_pcre2_general_context_create_32']) abort("external function 'pcre2_general_context_create_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_general_context_create_32'].apply(null, arguments);
  }

  function _pcre2_general_context_create_8(
  ) {
  if (!Module['_pcre2_general_context_create_8']) abort("external function 'pcre2_general_context_create_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_general_context_create_8'].apply(null, arguments);
  }

  function _pcre2_general_context_free_16(
  ) {
  if (!Module['_pcre2_general_context_free_16']) abort("external function 'pcre2_general_context_free_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_general_context_free_16'].apply(null, arguments);
  }

  function _pcre2_general_context_free_32(
  ) {
  if (!Module['_pcre2_general_context_free_32']) abort("external function 'pcre2_general_context_free_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_general_context_free_32'].apply(null, arguments);
  }

  function _pcre2_general_context_free_8(
  ) {
  if (!Module['_pcre2_general_context_free_8']) abort("external function 'pcre2_general_context_free_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_general_context_free_8'].apply(null, arguments);
  }

  function _pcre2_get_error_message_16(
  ) {
  if (!Module['_pcre2_get_error_message_16']) abort("external function 'pcre2_get_error_message_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_error_message_16'].apply(null, arguments);
  }

  function _pcre2_get_error_message_32(
  ) {
  if (!Module['_pcre2_get_error_message_32']) abort("external function 'pcre2_get_error_message_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_error_message_32'].apply(null, arguments);
  }

  function _pcre2_get_error_message_8(
  ) {
  if (!Module['_pcre2_get_error_message_8']) abort("external function 'pcre2_get_error_message_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_error_message_8'].apply(null, arguments);
  }

  function _pcre2_get_mark_16(
  ) {
  if (!Module['_pcre2_get_mark_16']) abort("external function 'pcre2_get_mark_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_mark_16'].apply(null, arguments);
  }

  function _pcre2_get_mark_32(
  ) {
  if (!Module['_pcre2_get_mark_32']) abort("external function 'pcre2_get_mark_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_mark_32'].apply(null, arguments);
  }

  function _pcre2_get_mark_8(
  ) {
  if (!Module['_pcre2_get_mark_8']) abort("external function 'pcre2_get_mark_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_mark_8'].apply(null, arguments);
  }

  function _pcre2_get_ovector_count_16(
  ) {
  if (!Module['_pcre2_get_ovector_count_16']) abort("external function 'pcre2_get_ovector_count_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_ovector_count_16'].apply(null, arguments);
  }

  function _pcre2_get_ovector_count_32(
  ) {
  if (!Module['_pcre2_get_ovector_count_32']) abort("external function 'pcre2_get_ovector_count_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_ovector_count_32'].apply(null, arguments);
  }

  function _pcre2_get_ovector_count_8(
  ) {
  if (!Module['_pcre2_get_ovector_count_8']) abort("external function 'pcre2_get_ovector_count_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_ovector_count_8'].apply(null, arguments);
  }

  function _pcre2_get_ovector_pointer_16(
  ) {
  if (!Module['_pcre2_get_ovector_pointer_16']) abort("external function 'pcre2_get_ovector_pointer_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_ovector_pointer_16'].apply(null, arguments);
  }

  function _pcre2_get_ovector_pointer_32(
  ) {
  if (!Module['_pcre2_get_ovector_pointer_32']) abort("external function 'pcre2_get_ovector_pointer_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_ovector_pointer_32'].apply(null, arguments);
  }

  function _pcre2_get_ovector_pointer_8(
  ) {
  if (!Module['_pcre2_get_ovector_pointer_8']) abort("external function 'pcre2_get_ovector_pointer_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_ovector_pointer_8'].apply(null, arguments);
  }

  function _pcre2_get_startchar_16(
  ) {
  if (!Module['_pcre2_get_startchar_16']) abort("external function 'pcre2_get_startchar_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_startchar_16'].apply(null, arguments);
  }

  function _pcre2_get_startchar_32(
  ) {
  if (!Module['_pcre2_get_startchar_32']) abort("external function 'pcre2_get_startchar_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_startchar_32'].apply(null, arguments);
  }

  function _pcre2_get_startchar_8(
  ) {
  if (!Module['_pcre2_get_startchar_8']) abort("external function 'pcre2_get_startchar_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_get_startchar_8'].apply(null, arguments);
  }

  function _pcre2_jit_compile_16(
  ) {
  if (!Module['_pcre2_jit_compile_16']) abort("external function 'pcre2_jit_compile_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_compile_16'].apply(null, arguments);
  }

  function _pcre2_jit_compile_32(
  ) {
  if (!Module['_pcre2_jit_compile_32']) abort("external function 'pcre2_jit_compile_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_compile_32'].apply(null, arguments);
  }

  function _pcre2_jit_compile_8(
  ) {
  if (!Module['_pcre2_jit_compile_8']) abort("external function 'pcre2_jit_compile_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_compile_8'].apply(null, arguments);
  }

  function _pcre2_jit_free_unused_memory_16(
  ) {
  if (!Module['_pcre2_jit_free_unused_memory_16']) abort("external function 'pcre2_jit_free_unused_memory_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_free_unused_memory_16'].apply(null, arguments);
  }

  function _pcre2_jit_free_unused_memory_32(
  ) {
  if (!Module['_pcre2_jit_free_unused_memory_32']) abort("external function 'pcre2_jit_free_unused_memory_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_free_unused_memory_32'].apply(null, arguments);
  }

  function _pcre2_jit_free_unused_memory_8(
  ) {
  if (!Module['_pcre2_jit_free_unused_memory_8']) abort("external function 'pcre2_jit_free_unused_memory_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_free_unused_memory_8'].apply(null, arguments);
  }

  function _pcre2_jit_match_16(
  ) {
  if (!Module['_pcre2_jit_match_16']) abort("external function 'pcre2_jit_match_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_match_16'].apply(null, arguments);
  }

  function _pcre2_jit_match_32(
  ) {
  if (!Module['_pcre2_jit_match_32']) abort("external function 'pcre2_jit_match_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_match_32'].apply(null, arguments);
  }

  function _pcre2_jit_match_8(
  ) {
  if (!Module['_pcre2_jit_match_8']) abort("external function 'pcre2_jit_match_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_match_8'].apply(null, arguments);
  }

  function _pcre2_jit_stack_assign_16(
  ) {
  if (!Module['_pcre2_jit_stack_assign_16']) abort("external function 'pcre2_jit_stack_assign_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_stack_assign_16'].apply(null, arguments);
  }

  function _pcre2_jit_stack_assign_32(
  ) {
  if (!Module['_pcre2_jit_stack_assign_32']) abort("external function 'pcre2_jit_stack_assign_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_stack_assign_32'].apply(null, arguments);
  }

  function _pcre2_jit_stack_assign_8(
  ) {
  if (!Module['_pcre2_jit_stack_assign_8']) abort("external function 'pcre2_jit_stack_assign_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_stack_assign_8'].apply(null, arguments);
  }

  function _pcre2_jit_stack_create_16(
  ) {
  if (!Module['_pcre2_jit_stack_create_16']) abort("external function 'pcre2_jit_stack_create_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_stack_create_16'].apply(null, arguments);
  }

  function _pcre2_jit_stack_create_32(
  ) {
  if (!Module['_pcre2_jit_stack_create_32']) abort("external function 'pcre2_jit_stack_create_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_stack_create_32'].apply(null, arguments);
  }

  function _pcre2_jit_stack_create_8(
  ) {
  if (!Module['_pcre2_jit_stack_create_8']) abort("external function 'pcre2_jit_stack_create_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_stack_create_8'].apply(null, arguments);
  }

  function _pcre2_jit_stack_free_16(
  ) {
  if (!Module['_pcre2_jit_stack_free_16']) abort("external function 'pcre2_jit_stack_free_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_stack_free_16'].apply(null, arguments);
  }

  function _pcre2_jit_stack_free_32(
  ) {
  if (!Module['_pcre2_jit_stack_free_32']) abort("external function 'pcre2_jit_stack_free_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_stack_free_32'].apply(null, arguments);
  }

  function _pcre2_jit_stack_free_8(
  ) {
  if (!Module['_pcre2_jit_stack_free_8']) abort("external function 'pcre2_jit_stack_free_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_jit_stack_free_8'].apply(null, arguments);
  }

  function _pcre2_maketables_16(
  ) {
  if (!Module['_pcre2_maketables_16']) abort("external function 'pcre2_maketables_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_maketables_16'].apply(null, arguments);
  }

  function _pcre2_maketables_32(
  ) {
  if (!Module['_pcre2_maketables_32']) abort("external function 'pcre2_maketables_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_maketables_32'].apply(null, arguments);
  }

  function _pcre2_maketables_8(
  ) {
  if (!Module['_pcre2_maketables_8']) abort("external function 'pcre2_maketables_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_maketables_8'].apply(null, arguments);
  }

  function _pcre2_match_16(
  ) {
  if (!Module['_pcre2_match_16']) abort("external function 'pcre2_match_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_16'].apply(null, arguments);
  }

  function _pcre2_match_32(
  ) {
  if (!Module['_pcre2_match_32']) abort("external function 'pcre2_match_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_32'].apply(null, arguments);
  }

  function _pcre2_match_8(
  ) {
  if (!Module['_pcre2_match_8']) abort("external function 'pcre2_match_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_8'].apply(null, arguments);
  }

  function _pcre2_match_context_copy_16(
  ) {
  if (!Module['_pcre2_match_context_copy_16']) abort("external function 'pcre2_match_context_copy_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_context_copy_16'].apply(null, arguments);
  }

  function _pcre2_match_context_copy_32(
  ) {
  if (!Module['_pcre2_match_context_copy_32']) abort("external function 'pcre2_match_context_copy_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_context_copy_32'].apply(null, arguments);
  }

  function _pcre2_match_context_copy_8(
  ) {
  if (!Module['_pcre2_match_context_copy_8']) abort("external function 'pcre2_match_context_copy_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_context_copy_8'].apply(null, arguments);
  }

  function _pcre2_match_context_create_16(
  ) {
  if (!Module['_pcre2_match_context_create_16']) abort("external function 'pcre2_match_context_create_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_context_create_16'].apply(null, arguments);
  }

  function _pcre2_match_context_create_32(
  ) {
  if (!Module['_pcre2_match_context_create_32']) abort("external function 'pcre2_match_context_create_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_context_create_32'].apply(null, arguments);
  }

  function _pcre2_match_context_create_8(
  ) {
  if (!Module['_pcre2_match_context_create_8']) abort("external function 'pcre2_match_context_create_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_context_create_8'].apply(null, arguments);
  }

  function _pcre2_match_context_free_16(
  ) {
  if (!Module['_pcre2_match_context_free_16']) abort("external function 'pcre2_match_context_free_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_context_free_16'].apply(null, arguments);
  }

  function _pcre2_match_context_free_32(
  ) {
  if (!Module['_pcre2_match_context_free_32']) abort("external function 'pcre2_match_context_free_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_context_free_32'].apply(null, arguments);
  }

  function _pcre2_match_context_free_8(
  ) {
  if (!Module['_pcre2_match_context_free_8']) abort("external function 'pcre2_match_context_free_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_context_free_8'].apply(null, arguments);
  }

  function _pcre2_match_data_create_16(
  ) {
  if (!Module['_pcre2_match_data_create_16']) abort("external function 'pcre2_match_data_create_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_data_create_16'].apply(null, arguments);
  }

  function _pcre2_match_data_create_32(
  ) {
  if (!Module['_pcre2_match_data_create_32']) abort("external function 'pcre2_match_data_create_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_data_create_32'].apply(null, arguments);
  }

  function _pcre2_match_data_create_8(
  ) {
  if (!Module['_pcre2_match_data_create_8']) abort("external function 'pcre2_match_data_create_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_data_create_8'].apply(null, arguments);
  }

  function _pcre2_match_data_create_from_pattern_16(
  ) {
  if (!Module['_pcre2_match_data_create_from_pattern_16']) abort("external function 'pcre2_match_data_create_from_pattern_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_data_create_from_pattern_16'].apply(null, arguments);
  }

  function _pcre2_match_data_create_from_pattern_32(
  ) {
  if (!Module['_pcre2_match_data_create_from_pattern_32']) abort("external function 'pcre2_match_data_create_from_pattern_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_data_create_from_pattern_32'].apply(null, arguments);
  }

  function _pcre2_match_data_create_from_pattern_8(
  ) {
  if (!Module['_pcre2_match_data_create_from_pattern_8']) abort("external function 'pcre2_match_data_create_from_pattern_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_data_create_from_pattern_8'].apply(null, arguments);
  }

  function _pcre2_match_data_free_16(
  ) {
  if (!Module['_pcre2_match_data_free_16']) abort("external function 'pcre2_match_data_free_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_data_free_16'].apply(null, arguments);
  }

  function _pcre2_match_data_free_32(
  ) {
  if (!Module['_pcre2_match_data_free_32']) abort("external function 'pcre2_match_data_free_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_data_free_32'].apply(null, arguments);
  }

  function _pcre2_match_data_free_8(
  ) {
  if (!Module['_pcre2_match_data_free_8']) abort("external function 'pcre2_match_data_free_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_match_data_free_8'].apply(null, arguments);
  }

  function _pcre2_pattern_convert_16(
  ) {
  if (!Module['_pcre2_pattern_convert_16']) abort("external function 'pcre2_pattern_convert_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_pattern_convert_16'].apply(null, arguments);
  }

  function _pcre2_pattern_convert_32(
  ) {
  if (!Module['_pcre2_pattern_convert_32']) abort("external function 'pcre2_pattern_convert_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_pattern_convert_32'].apply(null, arguments);
  }

  function _pcre2_pattern_convert_8(
  ) {
  if (!Module['_pcre2_pattern_convert_8']) abort("external function 'pcre2_pattern_convert_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_pattern_convert_8'].apply(null, arguments);
  }

  function _pcre2_pattern_info_16(
  ) {
  if (!Module['_pcre2_pattern_info_16']) abort("external function 'pcre2_pattern_info_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_pattern_info_16'].apply(null, arguments);
  }

  function _pcre2_pattern_info_32(
  ) {
  if (!Module['_pcre2_pattern_info_32']) abort("external function 'pcre2_pattern_info_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_pattern_info_32'].apply(null, arguments);
  }

  function _pcre2_pattern_info_8(
  ) {
  if (!Module['_pcre2_pattern_info_8']) abort("external function 'pcre2_pattern_info_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_pattern_info_8'].apply(null, arguments);
  }

  function _pcre2_serialize_decode_16(
  ) {
  if (!Module['_pcre2_serialize_decode_16']) abort("external function 'pcre2_serialize_decode_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_serialize_decode_16'].apply(null, arguments);
  }

  function _pcre2_serialize_decode_32(
  ) {
  if (!Module['_pcre2_serialize_decode_32']) abort("external function 'pcre2_serialize_decode_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_serialize_decode_32'].apply(null, arguments);
  }

  function _pcre2_serialize_decode_8(
  ) {
  if (!Module['_pcre2_serialize_decode_8']) abort("external function 'pcre2_serialize_decode_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_serialize_decode_8'].apply(null, arguments);
  }

  function _pcre2_serialize_encode_16(
  ) {
  if (!Module['_pcre2_serialize_encode_16']) abort("external function 'pcre2_serialize_encode_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_serialize_encode_16'].apply(null, arguments);
  }

  function _pcre2_serialize_encode_32(
  ) {
  if (!Module['_pcre2_serialize_encode_32']) abort("external function 'pcre2_serialize_encode_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_serialize_encode_32'].apply(null, arguments);
  }

  function _pcre2_serialize_encode_8(
  ) {
  if (!Module['_pcre2_serialize_encode_8']) abort("external function 'pcre2_serialize_encode_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_serialize_encode_8'].apply(null, arguments);
  }

  function _pcre2_serialize_free_16(
  ) {
  if (!Module['_pcre2_serialize_free_16']) abort("external function 'pcre2_serialize_free_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_serialize_free_16'].apply(null, arguments);
  }

  function _pcre2_serialize_free_32(
  ) {
  if (!Module['_pcre2_serialize_free_32']) abort("external function 'pcre2_serialize_free_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_serialize_free_32'].apply(null, arguments);
  }

  function _pcre2_serialize_free_8(
  ) {
  if (!Module['_pcre2_serialize_free_8']) abort("external function 'pcre2_serialize_free_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_serialize_free_8'].apply(null, arguments);
  }

  function _pcre2_serialize_get_number_of_codes_16(
  ) {
  if (!Module['_pcre2_serialize_get_number_of_codes_16']) abort("external function 'pcre2_serialize_get_number_of_codes_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_serialize_get_number_of_codes_16'].apply(null, arguments);
  }

  function _pcre2_serialize_get_number_of_codes_32(
  ) {
  if (!Module['_pcre2_serialize_get_number_of_codes_32']) abort("external function 'pcre2_serialize_get_number_of_codes_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_serialize_get_number_of_codes_32'].apply(null, arguments);
  }

  function _pcre2_serialize_get_number_of_codes_8(
  ) {
  if (!Module['_pcre2_serialize_get_number_of_codes_8']) abort("external function 'pcre2_serialize_get_number_of_codes_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_serialize_get_number_of_codes_8'].apply(null, arguments);
  }

  function _pcre2_set_bsr_16(
  ) {
  if (!Module['_pcre2_set_bsr_16']) abort("external function 'pcre2_set_bsr_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_bsr_16'].apply(null, arguments);
  }

  function _pcre2_set_bsr_32(
  ) {
  if (!Module['_pcre2_set_bsr_32']) abort("external function 'pcre2_set_bsr_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_bsr_32'].apply(null, arguments);
  }

  function _pcre2_set_bsr_8(
  ) {
  if (!Module['_pcre2_set_bsr_8']) abort("external function 'pcre2_set_bsr_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_bsr_8'].apply(null, arguments);
  }

  function _pcre2_set_character_tables_16(
  ) {
  if (!Module['_pcre2_set_character_tables_16']) abort("external function 'pcre2_set_character_tables_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_character_tables_16'].apply(null, arguments);
  }

  function _pcre2_set_character_tables_32(
  ) {
  if (!Module['_pcre2_set_character_tables_32']) abort("external function 'pcre2_set_character_tables_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_character_tables_32'].apply(null, arguments);
  }

  function _pcre2_set_character_tables_8(
  ) {
  if (!Module['_pcre2_set_character_tables_8']) abort("external function 'pcre2_set_character_tables_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_character_tables_8'].apply(null, arguments);
  }

  function _pcre2_set_compile_extra_options_16(
  ) {
  if (!Module['_pcre2_set_compile_extra_options_16']) abort("external function 'pcre2_set_compile_extra_options_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_compile_extra_options_16'].apply(null, arguments);
  }

  function _pcre2_set_compile_extra_options_32(
  ) {
  if (!Module['_pcre2_set_compile_extra_options_32']) abort("external function 'pcre2_set_compile_extra_options_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_compile_extra_options_32'].apply(null, arguments);
  }

  function _pcre2_set_compile_extra_options_8(
  ) {
  if (!Module['_pcre2_set_compile_extra_options_8']) abort("external function 'pcre2_set_compile_extra_options_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_compile_extra_options_8'].apply(null, arguments);
  }

  function _pcre2_set_compile_recursion_guard_16(
  ) {
  if (!Module['_pcre2_set_compile_recursion_guard_16']) abort("external function 'pcre2_set_compile_recursion_guard_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_compile_recursion_guard_16'].apply(null, arguments);
  }

  function _pcre2_set_compile_recursion_guard_32(
  ) {
  if (!Module['_pcre2_set_compile_recursion_guard_32']) abort("external function 'pcre2_set_compile_recursion_guard_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_compile_recursion_guard_32'].apply(null, arguments);
  }

  function _pcre2_set_compile_recursion_guard_8(
  ) {
  if (!Module['_pcre2_set_compile_recursion_guard_8']) abort("external function 'pcre2_set_compile_recursion_guard_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_compile_recursion_guard_8'].apply(null, arguments);
  }

  function _pcre2_set_depth_limit_16(
  ) {
  if (!Module['_pcre2_set_depth_limit_16']) abort("external function 'pcre2_set_depth_limit_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_depth_limit_16'].apply(null, arguments);
  }

  function _pcre2_set_depth_limit_32(
  ) {
  if (!Module['_pcre2_set_depth_limit_32']) abort("external function 'pcre2_set_depth_limit_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_depth_limit_32'].apply(null, arguments);
  }

  function _pcre2_set_depth_limit_8(
  ) {
  if (!Module['_pcre2_set_depth_limit_8']) abort("external function 'pcre2_set_depth_limit_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_depth_limit_8'].apply(null, arguments);
  }

  function _pcre2_set_glob_escape_16(
  ) {
  if (!Module['_pcre2_set_glob_escape_16']) abort("external function 'pcre2_set_glob_escape_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_glob_escape_16'].apply(null, arguments);
  }

  function _pcre2_set_glob_escape_32(
  ) {
  if (!Module['_pcre2_set_glob_escape_32']) abort("external function 'pcre2_set_glob_escape_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_glob_escape_32'].apply(null, arguments);
  }

  function _pcre2_set_glob_escape_8(
  ) {
  if (!Module['_pcre2_set_glob_escape_8']) abort("external function 'pcre2_set_glob_escape_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_glob_escape_8'].apply(null, arguments);
  }

  function _pcre2_set_glob_separator_16(
  ) {
  if (!Module['_pcre2_set_glob_separator_16']) abort("external function 'pcre2_set_glob_separator_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_glob_separator_16'].apply(null, arguments);
  }

  function _pcre2_set_glob_separator_32(
  ) {
  if (!Module['_pcre2_set_glob_separator_32']) abort("external function 'pcre2_set_glob_separator_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_glob_separator_32'].apply(null, arguments);
  }

  function _pcre2_set_glob_separator_8(
  ) {
  if (!Module['_pcre2_set_glob_separator_8']) abort("external function 'pcre2_set_glob_separator_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_glob_separator_8'].apply(null, arguments);
  }

  function _pcre2_set_heap_limit_16(
  ) {
  if (!Module['_pcre2_set_heap_limit_16']) abort("external function 'pcre2_set_heap_limit_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_heap_limit_16'].apply(null, arguments);
  }

  function _pcre2_set_heap_limit_32(
  ) {
  if (!Module['_pcre2_set_heap_limit_32']) abort("external function 'pcre2_set_heap_limit_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_heap_limit_32'].apply(null, arguments);
  }

  function _pcre2_set_heap_limit_8(
  ) {
  if (!Module['_pcre2_set_heap_limit_8']) abort("external function 'pcre2_set_heap_limit_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_heap_limit_8'].apply(null, arguments);
  }

  function _pcre2_set_match_limit_16(
  ) {
  if (!Module['_pcre2_set_match_limit_16']) abort("external function 'pcre2_set_match_limit_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_match_limit_16'].apply(null, arguments);
  }

  function _pcre2_set_match_limit_32(
  ) {
  if (!Module['_pcre2_set_match_limit_32']) abort("external function 'pcre2_set_match_limit_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_match_limit_32'].apply(null, arguments);
  }

  function _pcre2_set_match_limit_8(
  ) {
  if (!Module['_pcre2_set_match_limit_8']) abort("external function 'pcre2_set_match_limit_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_match_limit_8'].apply(null, arguments);
  }

  function _pcre2_set_max_pattern_length_16(
  ) {
  if (!Module['_pcre2_set_max_pattern_length_16']) abort("external function 'pcre2_set_max_pattern_length_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_max_pattern_length_16'].apply(null, arguments);
  }

  function _pcre2_set_max_pattern_length_32(
  ) {
  if (!Module['_pcre2_set_max_pattern_length_32']) abort("external function 'pcre2_set_max_pattern_length_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_max_pattern_length_32'].apply(null, arguments);
  }

  function _pcre2_set_max_pattern_length_8(
  ) {
  if (!Module['_pcre2_set_max_pattern_length_8']) abort("external function 'pcre2_set_max_pattern_length_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_max_pattern_length_8'].apply(null, arguments);
  }

  function _pcre2_set_newline_16(
  ) {
  if (!Module['_pcre2_set_newline_16']) abort("external function 'pcre2_set_newline_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_newline_16'].apply(null, arguments);
  }

  function _pcre2_set_newline_32(
  ) {
  if (!Module['_pcre2_set_newline_32']) abort("external function 'pcre2_set_newline_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_newline_32'].apply(null, arguments);
  }

  function _pcre2_set_newline_8(
  ) {
  if (!Module['_pcre2_set_newline_8']) abort("external function 'pcre2_set_newline_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_newline_8'].apply(null, arguments);
  }

  function _pcre2_set_offset_limit_16(
  ) {
  if (!Module['_pcre2_set_offset_limit_16']) abort("external function 'pcre2_set_offset_limit_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_offset_limit_16'].apply(null, arguments);
  }

  function _pcre2_set_offset_limit_32(
  ) {
  if (!Module['_pcre2_set_offset_limit_32']) abort("external function 'pcre2_set_offset_limit_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_offset_limit_32'].apply(null, arguments);
  }

  function _pcre2_set_offset_limit_8(
  ) {
  if (!Module['_pcre2_set_offset_limit_8']) abort("external function 'pcre2_set_offset_limit_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_offset_limit_8'].apply(null, arguments);
  }

  function _pcre2_set_parens_nest_limit_16(
  ) {
  if (!Module['_pcre2_set_parens_nest_limit_16']) abort("external function 'pcre2_set_parens_nest_limit_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_parens_nest_limit_16'].apply(null, arguments);
  }

  function _pcre2_set_parens_nest_limit_32(
  ) {
  if (!Module['_pcre2_set_parens_nest_limit_32']) abort("external function 'pcre2_set_parens_nest_limit_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_parens_nest_limit_32'].apply(null, arguments);
  }

  function _pcre2_set_parens_nest_limit_8(
  ) {
  if (!Module['_pcre2_set_parens_nest_limit_8']) abort("external function 'pcre2_set_parens_nest_limit_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_parens_nest_limit_8'].apply(null, arguments);
  }

  function _pcre2_set_recursion_limit_16(
  ) {
  if (!Module['_pcre2_set_recursion_limit_16']) abort("external function 'pcre2_set_recursion_limit_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_recursion_limit_16'].apply(null, arguments);
  }

  function _pcre2_set_recursion_limit_32(
  ) {
  if (!Module['_pcre2_set_recursion_limit_32']) abort("external function 'pcre2_set_recursion_limit_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_recursion_limit_32'].apply(null, arguments);
  }

  function _pcre2_set_recursion_limit_8(
  ) {
  if (!Module['_pcre2_set_recursion_limit_8']) abort("external function 'pcre2_set_recursion_limit_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_recursion_limit_8'].apply(null, arguments);
  }

  function _pcre2_set_recursion_memory_management_16(
  ) {
  if (!Module['_pcre2_set_recursion_memory_management_16']) abort("external function 'pcre2_set_recursion_memory_management_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_recursion_memory_management_16'].apply(null, arguments);
  }

  function _pcre2_set_recursion_memory_management_32(
  ) {
  if (!Module['_pcre2_set_recursion_memory_management_32']) abort("external function 'pcre2_set_recursion_memory_management_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_recursion_memory_management_32'].apply(null, arguments);
  }

  function _pcre2_set_recursion_memory_management_8(
  ) {
  if (!Module['_pcre2_set_recursion_memory_management_8']) abort("external function 'pcre2_set_recursion_memory_management_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_set_recursion_memory_management_8'].apply(null, arguments);
  }

  function _pcre2_substitute_16(
  ) {
  if (!Module['_pcre2_substitute_16']) abort("external function 'pcre2_substitute_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substitute_16'].apply(null, arguments);
  }

  function _pcre2_substitute_32(
  ) {
  if (!Module['_pcre2_substitute_32']) abort("external function 'pcre2_substitute_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substitute_32'].apply(null, arguments);
  }

  function _pcre2_substitute_8(
  ) {
  if (!Module['_pcre2_substitute_8']) abort("external function 'pcre2_substitute_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substitute_8'].apply(null, arguments);
  }

  function _pcre2_substring_copy_byname_16(
  ) {
  if (!Module['_pcre2_substring_copy_byname_16']) abort("external function 'pcre2_substring_copy_byname_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_copy_byname_16'].apply(null, arguments);
  }

  function _pcre2_substring_copy_byname_32(
  ) {
  if (!Module['_pcre2_substring_copy_byname_32']) abort("external function 'pcre2_substring_copy_byname_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_copy_byname_32'].apply(null, arguments);
  }

  function _pcre2_substring_copy_byname_8(
  ) {
  if (!Module['_pcre2_substring_copy_byname_8']) abort("external function 'pcre2_substring_copy_byname_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_copy_byname_8'].apply(null, arguments);
  }

  function _pcre2_substring_copy_bynumber_16(
  ) {
  if (!Module['_pcre2_substring_copy_bynumber_16']) abort("external function 'pcre2_substring_copy_bynumber_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_copy_bynumber_16'].apply(null, arguments);
  }

  function _pcre2_substring_copy_bynumber_32(
  ) {
  if (!Module['_pcre2_substring_copy_bynumber_32']) abort("external function 'pcre2_substring_copy_bynumber_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_copy_bynumber_32'].apply(null, arguments);
  }

  function _pcre2_substring_copy_bynumber_8(
  ) {
  if (!Module['_pcre2_substring_copy_bynumber_8']) abort("external function 'pcre2_substring_copy_bynumber_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_copy_bynumber_8'].apply(null, arguments);
  }

  function _pcre2_substring_free_16(
  ) {
  if (!Module['_pcre2_substring_free_16']) abort("external function 'pcre2_substring_free_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_free_16'].apply(null, arguments);
  }

  function _pcre2_substring_free_32(
  ) {
  if (!Module['_pcre2_substring_free_32']) abort("external function 'pcre2_substring_free_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_free_32'].apply(null, arguments);
  }

  function _pcre2_substring_free_8(
  ) {
  if (!Module['_pcre2_substring_free_8']) abort("external function 'pcre2_substring_free_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_free_8'].apply(null, arguments);
  }

  function _pcre2_substring_get_byname_16(
  ) {
  if (!Module['_pcre2_substring_get_byname_16']) abort("external function 'pcre2_substring_get_byname_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_get_byname_16'].apply(null, arguments);
  }

  function _pcre2_substring_get_byname_32(
  ) {
  if (!Module['_pcre2_substring_get_byname_32']) abort("external function 'pcre2_substring_get_byname_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_get_byname_32'].apply(null, arguments);
  }

  function _pcre2_substring_get_byname_8(
  ) {
  if (!Module['_pcre2_substring_get_byname_8']) abort("external function 'pcre2_substring_get_byname_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_get_byname_8'].apply(null, arguments);
  }

  function _pcre2_substring_get_bynumber_16(
  ) {
  if (!Module['_pcre2_substring_get_bynumber_16']) abort("external function 'pcre2_substring_get_bynumber_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_get_bynumber_16'].apply(null, arguments);
  }

  function _pcre2_substring_get_bynumber_32(
  ) {
  if (!Module['_pcre2_substring_get_bynumber_32']) abort("external function 'pcre2_substring_get_bynumber_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_get_bynumber_32'].apply(null, arguments);
  }

  function _pcre2_substring_get_bynumber_8(
  ) {
  if (!Module['_pcre2_substring_get_bynumber_8']) abort("external function 'pcre2_substring_get_bynumber_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_get_bynumber_8'].apply(null, arguments);
  }

  function _pcre2_substring_length_byname_16(
  ) {
  if (!Module['_pcre2_substring_length_byname_16']) abort("external function 'pcre2_substring_length_byname_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_length_byname_16'].apply(null, arguments);
  }

  function _pcre2_substring_length_byname_32(
  ) {
  if (!Module['_pcre2_substring_length_byname_32']) abort("external function 'pcre2_substring_length_byname_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_length_byname_32'].apply(null, arguments);
  }

  function _pcre2_substring_length_byname_8(
  ) {
  if (!Module['_pcre2_substring_length_byname_8']) abort("external function 'pcre2_substring_length_byname_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_length_byname_8'].apply(null, arguments);
  }

  function _pcre2_substring_length_bynumber_16(
  ) {
  if (!Module['_pcre2_substring_length_bynumber_16']) abort("external function 'pcre2_substring_length_bynumber_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_length_bynumber_16'].apply(null, arguments);
  }

  function _pcre2_substring_length_bynumber_32(
  ) {
  if (!Module['_pcre2_substring_length_bynumber_32']) abort("external function 'pcre2_substring_length_bynumber_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_length_bynumber_32'].apply(null, arguments);
  }

  function _pcre2_substring_length_bynumber_8(
  ) {
  if (!Module['_pcre2_substring_length_bynumber_8']) abort("external function 'pcre2_substring_length_bynumber_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_length_bynumber_8'].apply(null, arguments);
  }

  function _pcre2_substring_list_free_16(
  ) {
  if (!Module['_pcre2_substring_list_free_16']) abort("external function 'pcre2_substring_list_free_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_list_free_16'].apply(null, arguments);
  }

  function _pcre2_substring_list_free_32(
  ) {
  if (!Module['_pcre2_substring_list_free_32']) abort("external function 'pcre2_substring_list_free_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_list_free_32'].apply(null, arguments);
  }

  function _pcre2_substring_list_free_8(
  ) {
  if (!Module['_pcre2_substring_list_free_8']) abort("external function 'pcre2_substring_list_free_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_list_free_8'].apply(null, arguments);
  }

  function _pcre2_substring_list_get_16(
  ) {
  if (!Module['_pcre2_substring_list_get_16']) abort("external function 'pcre2_substring_list_get_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_list_get_16'].apply(null, arguments);
  }

  function _pcre2_substring_list_get_32(
  ) {
  if (!Module['_pcre2_substring_list_get_32']) abort("external function 'pcre2_substring_list_get_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_list_get_32'].apply(null, arguments);
  }

  function _pcre2_substring_list_get_8(
  ) {
  if (!Module['_pcre2_substring_list_get_8']) abort("external function 'pcre2_substring_list_get_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_list_get_8'].apply(null, arguments);
  }

  function _pcre2_substring_nametable_scan_16(
  ) {
  if (!Module['_pcre2_substring_nametable_scan_16']) abort("external function 'pcre2_substring_nametable_scan_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_nametable_scan_16'].apply(null, arguments);
  }

  function _pcre2_substring_nametable_scan_32(
  ) {
  if (!Module['_pcre2_substring_nametable_scan_32']) abort("external function 'pcre2_substring_nametable_scan_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_nametable_scan_32'].apply(null, arguments);
  }

  function _pcre2_substring_nametable_scan_8(
  ) {
  if (!Module['_pcre2_substring_nametable_scan_8']) abort("external function 'pcre2_substring_nametable_scan_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_nametable_scan_8'].apply(null, arguments);
  }

  function _pcre2_substring_number_from_name_16(
  ) {
  if (!Module['_pcre2_substring_number_from_name_16']) abort("external function 'pcre2_substring_number_from_name_16' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_number_from_name_16'].apply(null, arguments);
  }

  function _pcre2_substring_number_from_name_32(
  ) {
  if (!Module['_pcre2_substring_number_from_name_32']) abort("external function 'pcre2_substring_number_from_name_32' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_number_from_name_32'].apply(null, arguments);
  }

  function _pcre2_substring_number_from_name_8(
  ) {
  if (!Module['_pcre2_substring_number_from_name_8']) abort("external function 'pcre2_substring_number_from_name_8' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_pcre2_substring_number_from_name_8'].apply(null, arguments);
  }

  function _raise(sig) {
      err('Calling stub instead of raise()');
    ___setErrNo(ERRNO_CODES.ENOSYS);
      warnOnce('raise() returning an error as we do not support it');
      return -1;
    }


   

  function _setenv(envname, envval, overwrite) {
      // int setenv(const char *envname, const char *envval, int overwrite);
      // http://pubs.opengroup.org/onlinepubs/009695399/functions/setenv.html
      if (envname === 0) {
        ___setErrNo(22);
        return -1;
      }
      var name = UTF8ToString(envname);
      var val = UTF8ToString(envval);
      if (name === '' || name.indexOf('=') !== -1) {
        ___setErrNo(22);
        return -1;
      }
      if (ENV.hasOwnProperty(name) && !overwrite) return 0;
      ENV[name] = val;
      ___buildEnvironment(__get_environ());
      return 0;
    }

  function _siglongjmp(env, value) {
      // We cannot wrap the sigsetjmp, but I hope that
      // in most cases siglongjmp will be called later.
  
      // siglongjmp can be called very many times, so don't flood the stderr.
      warnOnce("Calling longjmp() instead of siglongjmp()");
      _longjmp(env, value);
    }

  function _string_from_id(id) {
          var s = $("#" + UTF8ToString(id+4))[0].value; 
          var ptr  = allocate(intArrayFromString(s), 'i8', ALLOC_NORMAL);
          return ptr;
      }

  function _sysconf(name) {
      // long sysconf(int name);
      // http://pubs.opengroup.org/onlinepubs/009695399/functions/sysconf.html
      switch(name) {
        case 30: return PAGE_SIZE;
        case 85:
          var maxHeapSize = 2*1024*1024*1024 - 65536;
          return maxHeapSize / PAGE_SIZE;
        case 132:
        case 133:
        case 12:
        case 137:
        case 138:
        case 15:
        case 235:
        case 16:
        case 17:
        case 18:
        case 19:
        case 20:
        case 149:
        case 13:
        case 10:
        case 236:
        case 153:
        case 9:
        case 21:
        case 22:
        case 159:
        case 154:
        case 14:
        case 77:
        case 78:
        case 139:
        case 80:
        case 81:
        case 82:
        case 68:
        case 67:
        case 164:
        case 11:
        case 29:
        case 47:
        case 48:
        case 95:
        case 52:
        case 51:
        case 46:
          return 200809;
        case 79:
          return 0;
        case 27:
        case 246:
        case 127:
        case 128:
        case 23:
        case 24:
        case 160:
        case 161:
        case 181:
        case 182:
        case 242:
        case 183:
        case 184:
        case 243:
        case 244:
        case 245:
        case 165:
        case 178:
        case 179:
        case 49:
        case 50:
        case 168:
        case 169:
        case 175:
        case 170:
        case 171:
        case 172:
        case 97:
        case 76:
        case 32:
        case 173:
        case 35:
          return -1;
        case 176:
        case 177:
        case 7:
        case 155:
        case 8:
        case 157:
        case 125:
        case 126:
        case 92:
        case 93:
        case 129:
        case 130:
        case 131:
        case 94:
        case 91:
          return 1;
        case 74:
        case 60:
        case 69:
        case 70:
        case 4:
          return 1024;
        case 31:
        case 42:
        case 72:
          return 32;
        case 87:
        case 26:
        case 33:
          return 2147483647;
        case 34:
        case 1:
          return 47839;
        case 38:
        case 36:
          return 99;
        case 43:
        case 37:
          return 2048;
        case 0: return 2097152;
        case 3: return 65536;
        case 28: return 32768;
        case 44: return 32767;
        case 75: return 16384;
        case 39: return 1000;
        case 89: return 700;
        case 71: return 256;
        case 40: return 255;
        case 2: return 100;
        case 180: return 64;
        case 25: return 20;
        case 5: return 16;
        case 6: return 6;
        case 73: return 4;
        case 84: {
          if (typeof navigator === 'object') return navigator['hardwareConcurrency'] || 1;
          return 1;
        }
      }
      ___setErrNo(22);
      return -1;
    }


  function _timer_create(
  ) {
  if (!Module['_timer_create']) abort("external function 'timer_create' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_timer_create'].apply(null, arguments);
  }

  function _timer_delete(
  ) {
  if (!Module['_timer_delete']) abort("external function 'timer_delete' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_timer_delete'].apply(null, arguments);
  }

  function _timer_settime(
  ) {
  if (!Module['_timer_settime']) abort("external function 'timer_settime' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['_timer_settime'].apply(null, arguments);
  }

  function _unsetenv(name) {
      // int unsetenv(const char *name);
      // http://pubs.opengroup.org/onlinepubs/009695399/functions/unsetenv.html
      if (name === 0) {
        ___setErrNo(22);
        return -1;
      }
      name = UTF8ToString(name);
      if (name === '' || name.indexOf('=') !== -1) {
        ___setErrNo(22);
        return -1;
      }
      if (ENV.hasOwnProperty(name)) {
        delete ENV[name];
        ___buildEnvironment(__get_environ());
      }
      return 0;
    }

  function _update_id(chunkid, chunkresult) {
          $('#' + UTF8ToString(chunkid+4)).html(UTF8ToString(chunkresult+4));
      }

  function _update_id0(chunkid, chunkresult) {
          $('#' + UTF8ToString(chunkid+4)).html(chunkresult);
      }

  function __ZTVN4llvm18raw_string_ostreamE(
  ) {
  if (!Module['__ZTVN4llvm18raw_string_ostreamE']) abort("external function '_ZTVN4llvm18raw_string_ostreamE' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['__ZTVN4llvm18raw_string_ostreamE'].apply(null, arguments);
  }

  function ___gmp_bits_per_limb(
  ) {
  if (!Module['___gmp_bits_per_limb']) abort("external function '__gmp_bits_per_limb' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_bits_per_limb'].apply(null, arguments);
  }

  function ___gmp_version(
  ) {
  if (!Module['___gmp_version']) abort("external function '__gmp_version' is missing. perhaps a side module was not linked in? if this function was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module['___gmp_version'].apply(null, arguments);
  }
if (ENVIRONMENT_IS_NODE) {
    _emscripten_get_now = function _emscripten_get_now_actual() {
      var t = process['hrtime']();
      return t[0] * 1e3 + t[1] / 1e6;
    };
  } else if (typeof dateNow !== 'undefined') {
    _emscripten_get_now = dateNow;
  } else if (typeof performance === 'object' && performance && typeof performance['now'] === 'function') {
    _emscripten_get_now = function() { return performance['now'](); };
  } else {
    _emscripten_get_now = Date.now;
  };
FS.staticInit();;
if (ENVIRONMENT_IS_NODE) { var fs = require("fs"); var NODEJS_PATH = require("path"); NODEFS.staticInit(); };
var ASSERTIONS = true;

// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

/** @type {function(string, boolean=, number=)} */
function intArrayFromString(stringy, dontAddNull, length) {
  var len = length > 0 ? length : lengthBytesUTF8(stringy)+1;
  var u8array = new Array(len);
  var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
  if (dontAddNull) u8array.length = numBytesWritten;
  return u8array;
}

function intArrayToString(array) {
  var ret = [];
  for (var i = 0; i < array.length; i++) {
    var chr = array[i];
    if (chr > 0xFF) {
      if (ASSERTIONS) {
        assert(false, 'Character code ' + chr + ' (' + String.fromCharCode(chr) + ')  at offset ' + i + ' not in 0x00-0xFF.');
      }
      chr &= 0xFF;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join('');
}


// ASM_LIBRARY EXTERN PRIMITIVES: Math_clz32,Math_imul,Math_floor,Math_ceil,Int8Array,Int32Array


var debug_table_X = ["0", "jsCall_X_0", "jsCall_X_1", "jsCall_X_2", "jsCall_X_3", "jsCall_X_4", "jsCall_X_5", "jsCall_X_6", "jsCall_X_7", "jsCall_X_8", "jsCall_X_9", "jsCall_X_10", "jsCall_X_11", "jsCall_X_12", "jsCall_X_13", "jsCall_X_14", "jsCall_X_15", "jsCall_X_16", "jsCall_X_17", "jsCall_X_18", "jsCall_X_19", "asm['_print_iostream']", "asm['_relocate_iostream']", "asm['_free_iostream']", "asm['_fl_defined_julia_global']", "asm['_fl_current_module_counter']", "asm['_fl_julia_scalar']", "asm['_fl_julia_logmsg']", "asm['_cvalue_new']", "asm['_cvalue_typeof']", "asm['_cvalue_sizeof']", "asm['_fl_builtin']", "asm['_fl_copy']", "asm['_fl_podp']", "asm['_fl_logand']", "asm['_fl_logior']", "asm['_fl_logxor']", "asm['_fl_lognot']", "asm['_fl_ash']", "asm['_fl_function']", "asm['_fl_function_code']", "asm['_fl_function_vals']", "asm['_fl_function_env']", "asm['_fl_function_name']", "asm['_fl_stacktrace']", "asm['_fl_gensym']", "asm['_fl_gensymp']", "asm['_fl_hash']", "asm['_fl_copylist']", "asm['_fl_append']", "asm['_fl_liststar']", "asm['_fl_map1']", "asm['_fl_foreach']", "asm['_fl_skipws']", "asm['_fl_accum_julia_symbol']", "asm['_fl_julia_identifier_char']", "asm['_fl_julia_identifier_start_char']", "asm['_fl_julia_never_identifier_char']", "asm['_fl_julia_op_suffix_char']", "asm['_fl_julia_strip_op_suffix']", "asm['_fl_julia_underscore_symbolp']", "asm['_fl_global_env']", "asm['_fl_constantp']", "asm['_fl_top_level_value']", "asm['_fl_set_top_level_value']", "asm['_fl_f_raise']", "asm['_fl_exit']", "asm['_fl_symbol']", "asm['_fl_keywordp']", "asm['_fl_fixnum']", "asm['_fl_truncate']", "asm['_fl_integerp']", "asm['_fl_integer_valuedp']", "asm['_fl_nconc']", "asm['_fl_assq']", "asm['_fl_memq']", "asm['_fl_length']", "asm['_fl_vector_alloc']", "asm['_fl_time_now']", "asm['_fl_path_cwd']", "asm['_fl_path_exists']", "asm['_fl_os_getenv']", "asm['_fl_os_setenv']", "asm['_fl_iostreamp']", "asm['_fl_eof_object']", "asm['_fl_eof_objectp']", "asm['_fl_file']", "asm['_fl_buffer']", "asm['_fl_read']", "asm['_fl_write']", "asm['_fl_ioflush']", "asm['_fl_ioclose']", "asm['_fl_ioeof']", "asm['_fl_ioseek']", "asm['_fl_iopos']", "asm['_fl_iogetc']", "asm['_fl_ioungetc']", "asm['_fl_ioputc']", "asm['_fl_iopeekc']", "asm['_fl_iopurge']", "asm['_fl_ioread']", "asm['_fl_iowrite']", "asm['_fl_iocopy']", "asm['_fl_ioreaduntil']", "asm['_fl_iocopyuntil']", "asm['_fl_iotostring']", "asm['_fl_iolineno']", "asm['_fl_iocolno']", "asm['_fl_table']", "asm['_fl_tablep']", "asm['_fl_table_put']", "asm['_fl_table_get']", "asm['_fl_table_has']", "asm['_fl_table_del']", "asm['_fl_table_foldl']", "asm['_fl_string']", "asm['_fl_stringp']", "asm['_fl_string_count']", "asm['_fl_string_sub']", "asm['_fl_string_find']", "asm['_fl_string_char']", "asm['_fl_string_inc']", "asm['_fl_string_dec']", "asm['_fl_string_isutf8']", "asm['_fl_numbertostring']", "asm['_fl_stringtonumber']", "asm['_jl_LLVMFlipSign']", "asm['_jl_flipsign_int8']", "asm['_jl_flipsign_int16']", "asm['_jl_flipsign_int32']", "asm['_jl_flipsign_int64']", "asm['_LLVMRem_uov']", "asm['_LLVMRem_sov']", "asm['_LLVMDiv_uov']", "asm['_LLVMDiv_sov']", "asm['_LLVMMul_uov']", "asm['_LLVMMul_sov']", "asm['_LLVMSub_uov']", "asm['_jl_checked_usub_int8']", "asm['_jl_checked_usub_int16']", "asm['_jl_checked_usub_int32']", "asm['_jl_checked_usub_int64']", "asm['_LLVMSub_sov']", "asm['_jl_checked_ssub_int8']", "asm['_jl_checked_ssub_int16']", "asm['_jl_checked_ssub_int32']", "asm['_jl_checked_ssub_int64']", "asm['_LLVMAdd_uov']", "asm['_jl_checked_uadd_int8']", "asm['_jl_checked_uadd_int16']", "asm['_jl_checked_uadd_int32']", "asm['_jl_checked_uadd_int64']", "asm['_LLVMAdd_sov']", "asm['_jl_checked_sadd_int8']", "asm['_jl_checked_sadd_int16']", "asm['_jl_checked_sadd_int32']", "asm['_jl_checked_sadd_int64']", "asm['_LLVMCountTrailingZeros']", "asm['_LLVMCountLeadingZeros']", "asm['_LLVMCountPopulation']", "asm['_LLVMByteSwap']", "asm['_LLVMAShr']", "asm['_jl_ashr_int8']", "asm['_jl_ashr_int16']", "asm['_jl_ashr_int32']", "asm['_jl_ashr_int64']", "asm['_LLVMLShr']", "asm['_jl_lshr_int8']", "asm['_jl_lshr_int16']", "asm['_jl_lshr_int32']", "asm['_jl_lshr_int64']", "asm['_LLVMShl']", "asm['_jl_shl_int8']", "asm['_jl_shl_int16']", "asm['_jl_shl_int32']", "asm['_jl_shl_int64']", "asm['_LLVMXor']", "asm['_jl_xor_int8']", "asm['_jl_xor_int16']", "asm['_jl_xor_int32']", "asm['_jl_xor_int64']", "asm['_LLVMOr']", "asm['_jl_or_int8']", "asm['_jl_or_int16']", "asm['_jl_or_int32']", "asm['_jl_or_int64']", "asm['_LLVMAnd']", "asm['_jl_and_int8']", "asm['_jl_and_int16']", "asm['_jl_and_int32']", "asm['_jl_and_int64']", "asm['_LLVMFlipAllBits']", "asm['_jl_not_int8']", "asm['_jl_not_int16']", "asm['_jl_not_int32']", "asm['_jl_not_int64']", "asm['_LLVMICmpULE']", "asm['_jl_ule_int8']", "asm['_jl_ule_int16']", "asm['_jl_ule_int32']", "asm['_jl_ule_int64']", "asm['_LLVMICmpSLE']", "asm['_jl_sle_int8']", "asm['_jl_sle_int16']", "asm['_jl_sle_int32']", "asm['_jl_sle_int64']", "asm['_LLVMICmpULT']", "asm['_jl_ult_int8']", "asm['_jl_ult_int16']", "asm['_jl_ult_int32']", "asm['_jl_ult_int64']", "asm['_LLVMICmpSLT']", "asm['_jl_slt_int8']", "asm['_jl_slt_int16']", "asm['_jl_slt_int32']", "asm['_jl_slt_int64']", "asm['_LLVMICmpNE']", "asm['_jl_ne_int8']", "asm['_jl_ne_int16']", "asm['_jl_ne_int32']", "asm['_jl_ne_int64']", "asm['_LLVMICmpEQ']", "asm['_jl_eq_int8']", "asm['_jl_eq_int16']", "asm['_jl_eq_int32']", "asm['_jl_eq_int64']", "asm['_LLVMSub']", "asm['_jl_sub_ptr8']", "asm['_jl_sub_ptr16']", "asm['_jl_sub_ptr32']", "asm['_jl_sub_ptr64']", "asm['_LLVMAdd']", "asm['_jl_add_ptr8']", "asm['_jl_add_ptr16']", "asm['_jl_add_ptr32']", "asm['_jl_add_ptr64']", "asm['_LLVMURem']", "asm['_jl_urem_int8']", "asm['_jl_urem_int16']", "asm['_jl_urem_int32']", "asm['_jl_urem_int64']", "asm['_LLVMSRem']", "asm['_jl_srem_int8']", "asm['_jl_srem_int16']", "asm['_jl_srem_int32']", "asm['_jl_srem_int64']", "asm['_LLVMUDiv']", "asm['_jl_udiv_int8']", "asm['_jl_udiv_int16']", "asm['_jl_udiv_int32']", "asm['_jl_udiv_int64']", "asm['_LLVMSDiv']", "asm['_jl_sdiv_int8']", "asm['_jl_sdiv_int16']", "asm['_jl_sdiv_int32']", "asm['_jl_sdiv_int64']", "asm['_LLVMMul']", "asm['_jl_mul_int8']", "asm['_jl_mul_int16']", "asm['_jl_mul_int32']", "asm['_jl_mul_int64']", "asm['_jl_sub_int8']", "asm['_jl_sub_int16']", "asm['_jl_sub_int32']", "asm['_jl_sub_int64']", "asm['_jl_add_int8']", "asm['_jl_add_int16']", "asm['_jl_add_int32']", "asm['_jl_add_int64']", "asm['_LLVMNeg']", "asm['_jl_neg_int8']", "asm['_jl_neg_int16']", "asm['_jl_neg_int32']", "asm['_jl_neg_int64']", "asm['_jl_f_throw']", "asm['_jl_f_is']", "asm['_jl_f_typeof']", "asm['_jl_f_issubtype']", "asm['_jl_f_isa']", "asm['_jl_f_typeassert']", "asm['_jl_f__apply']", "asm['_jl_f__apply_pure']", "asm['_jl_f__apply_latest']", "asm['_jl_f_isdefined']", "asm['_jl_f_tuple']", "asm['_jl_f_svec']", "asm['_jl_f_intrinsic_call']", "asm['_jl_f_invoke_kwsorter']", "asm['_jl_f_getfield']", "asm['_jl_f_setfield']", "asm['_jl_f_fieldtype']", "asm['_jl_f_nfields']", "asm['_jl_f_arrayref']", "asm['_jl_f_arrayset']", "asm['_jl_f_arraysize']", "asm['_jl_f_apply_type']", "asm['_jl_f_applicable']", "asm['_jl_f_invoke']", "asm['_jl_f_sizeof']", "asm['_jl_f__expr']", "asm['_jl_f__typevar']", "asm['_jl_f_ifelse']", "asm['___stdio_close']", "asm['___stdout_write']", "asm['___stdio_seek']", "asm['___stdio_write']", "asm['_sn_write']", "asm['_jl_excstack_state']", "asm['_jl_enter_handler']", "asm['_jl_apply_generic']", "asm['_jl_eh_restore_state']", "asm['_jl_printf']", "asm['_jl_current_exception']", "asm['_jl_static_show']", "asm['_jl_restore_excstack']", "asm['_apply_cl']", "asm['_cvalue_int8']", "asm['_cvalue_uint8']", "asm['_cvalue_int16']", "asm['_cvalue_uint16']", "asm['_cvalue_int32']", "asm['_cvalue_uint32']", "asm['_cvalue_int64']", "asm['_cvalue_uint64']", "asm['_cvalue_byte']", "asm['_cvalue_wchar']", "asm['_cvalue_ptrdiff']", "asm['_cvalue_size']", "asm['_cvalue_float']", "asm['_cvalue_double']", "asm['_cvalue_array']", "asm['_cvalue_int8_init']", "asm['_cvalue_uint8_init']", "asm['_cvalue_int16_init']", "asm['_cvalue_uint16_init']", "asm['_cvalue_int32_init']", "asm['_cvalue_uint32_init']", "asm['_cvalue_int64_init']", "asm['_cvalue_uint64_init']", "asm['_cvalue_float_init']", "asm['_cvalue_double_init']", "asm['_scm_to_julia_']", "asm['_jl_exprn']", "asm['_jl_cstr_to_string']", "asm['_jl_gc_queue_root']", "asm['_union_sort_cmp']", "asm['_forall_exists_subtype']", "asm['_intersect']", "asm['_set_var_to_const']", "asm['_jl_egal']", "asm['_intersect_all']", "asm['_simple_join']", "asm['_intersect_var']", "asm['_jl_has_free_typevars']", "asm['_intersect_union']", "asm['_intersect_unionall']", "asm['_save_env']", "asm['_jl_has_typevar']", "asm['_free']", "asm['_jl_wrap_Type']", "asm['_jl_unwrap_unionall']", "asm['_jl_alloc_svec']", "asm['_intersect_vararg_length']", "asm['_jl_apply_tuple_type_v']", "asm['_jl_unbox_int32']", "asm['_jl_box_int32']", "asm['_jl_apply_tuple_type']", "asm['_intersect_invariant']", "asm['_jl_apply_type2']", "asm['_jl_apply_type']", "asm['_intersect_sub_datatype']", "asm['_jl_rewrap_unionall']", "asm['_obviously_egal']", "asm['_var_occurs_inside']", "asm['_jl_new_typevar']", "asm['_jl_substitute_var']", "asm['_jl_alloc_array_1d']", "asm['_jl_array_ptr_1d_push']", "asm['_jl_new_struct']", "asm['_jl_instantiate_unionall']", "asm['_fix_inferred_var_bound']", "asm['_fl_read_sexpr']", "asm['_ios_eof']", "asm['__applyn']", "asm['_type_error']", "asm['_ios_close']", "asm['_ios_write']", "asm['_fl_print']", "asm['_ios_putc']", "asm['_cvalue_array_init']", "asm['_jl_charmap_map']", "asm['_print_htable']", "asm['_relocate_htable']", "asm['_free_htable']", "asm['_print_traverse_htable']", "asm['_ml_matches_visitor']", "asm['_jlbacktrace']", "asm['_jl_fptr_trampoline']", "asm['_jl_fptr_interpret_call']", "asm['_jl_interpret_call_callback']", "asm['_jl_box_uint32']", "asm['_jl_lookup_generic_']", "asm['_jl_error']", "asm['_jl_get_nth_field_noalloc']", "asm['_eval_value']", "asm['_jl_get_binding_wr']", "asm['_jl_checked_assignment']", "asm['_jl_type_error']", "asm['_jl_box_ssavalue']", "asm['_eval_body']", "_emscripten_longjmp", "asm['_jl_unbox_uint32']", "asm['_jl_declare_constant']", "asm['_eval_methoddef']", "asm['_eval_abstracttype']", "asm['_eval_primitivetype']", "asm['_eval_structtype']", "asm['_jl_is_toplevel_only_expr']", "asm['_jl_toplevel_eval']", "asm['_jl_set_module_nospecialize']", "asm['_jl_get_nth_field']", "asm['_eval_phi']", "asm['_jl_new_abstracttype']", "asm['_jl_errorf']", "asm['_gc_queue_binding']", "asm['_jl_set_datatype_super']", "asm['_jl_reinstantiate_inner_types']", "asm['_jl_reset_instantiate_inner_types']", "asm['_jl_rethrow']", "asm['_equiv_type']", "asm['_jl_new_primitivetype']", "asm['_jl_new_datatype']", "asm['_jl_compute_field_offsets']", "asm['_jl_type_error_rt']", "asm['_jl_interpret_toplevel_expr_in_callback']", "asm['_jl_interpret_toplevel_thunk_callback']", "asm['_jl_module_globalref']", "asm['_jl_toplevel_eval_flex']", "asm['_jl_too_few_args']", "asm['_jl_too_many_args']", "asm['_jl_interpret_toplevel_expr_in']", "asm['_resolve_globals']", "asm['_strcmp']", "asm['_jl_binding_resolved_p']", "asm['_jl_get_binding']", "asm['_jl_symbol']", "asm['_jl_get_global']", "asm['_jl_rethrow_other']", "asm['_jl_method_lookup']", "asm['_jl_method_error']", "asm['_fl_savestate']", "asm['_julia_to_scm_']", "asm['_fl_restorestate']", "asm['_jl_types_equal']", "asm['_check_ambiguous_visitor']", "asm['_invalidate_backedges']", "asm['_set_max_world2']", "asm['_jl_fptr_const_return']", "asm['_jl_static_show_x_']", "asm['_jl_call_staged']", "asm['_jl_expand']", "asm['_jl_resolve_globals_in_ir']", "asm['_jl_linenumber_to_lineinfo']", "asm['_jl_field_index']", "asm['_jl_init']", "asm['_jl_write_compiler_output']", "asm['_jl_write_coverage_data']", "asm['_jl_write_malloc_log']", "asm['_jl_get_world_counter']", "asm['_jl_gc_run_all_finalizers']", "asm['_strlen']", "asm['_jl_parse_input_line']", "asm['_jl_toplevel_eval_in']", "asm['_jl_load_dynamic_library']", "asm['_jl_generating_output']", "asm['_ptrhash_has']", "asm['_jl_fptr_args']", "asm['_jl_fptr_sparam']", "asm['__jl_instantiate_type_in_env']", "asm['_htable_new']", "asm['_ptrhash_bp']", "asm['_malloc']", "asm['_ptrhash_get']", "asm['_jl_new_struct_uninit']", "asm['_jl_gc_perm_alloc']", "asm['__ZL18trampoline_deleterPPv']", "asm['_jl_gc_add_finalizer']", "asm['_jl_instantiate_type_in_env']", "asm['___mmap']", "asm['_ptrhash_put']", "___gmpz_clear", "asm['_jl_gc_counted_malloc']", "asm['_jl_gc_counted_realloc_with_old_size']", "asm['_jl_gc_counted_free_with_size']", "asm['_jl_intrinsiclambda_ty1']", "asm['_usignbitbyte']", "asm['_jl_intrinsiclambda_2']", "asm['_signbitbyte']", "asm['_jl_intrinsiclambda_cmp']", "asm['_jl_intrinsiclambda_u1']", "asm['_LLVMSExt']", "asm['_LLVMZExt']", "asm['_LLVMTrunc']", "asm['_LLVMSItoFP']", "asm['_LLVMUItoFP']", "asm['_LLVMFPtoUI']", "asm['_LLVMFPtoSI']", "asm['_jl_intrinsiclambda_checked']", "asm['_jl_intrinsiclambda_checkeddiv']", "asm['_set_min_world2']", "asm['_reset_mt_caches']", "asm['_typemap_search']", "asm['_check_disabled_ambiguous_visitor']", "asm['_get_method_unspec_list']", "asm['_get_spec_unspec_list']", "asm['_jl_malloc_stack']", "asm['_jl_release_task_stack']", "asm['_save_stack']", "asm['_jl_swap_fiber']", "asm['_restore_stack']", "asm['_jl_set_fiber']", "asm['_jl_start_fiber']", "_abort", "asm['_jl_ast_ctx_enter']", "asm['_cvalue_static_cstrn']", "asm['_fl_gc_handle']", "asm['_symbol']", "asm['_fl_applyn']", "asm['_fl_free_gc_handles']", "asm['_jl_ast_ctx_leave']", "asm['_scm_to_julia']", "asm['_jl_expand_macros']", "asm['_julia_to_scm']", "asm['_jl_pchar_to_string']", "asm['_size_isgreater']", "asm['_trace_method']", "asm['_jl_idtable_rehash']", "asm['_jl_typemap_rehash']", "asm['_arraylist_push']", "asm['_jl_collect_methcache_from_mod']", "asm['_jl_collect_backedges_to_mod']", "asm['_dt_compare']", "asm['_sysimg_sort_order']", "asm['_compile_all_enq_']", "asm['_precompile_enq_all_specializations_']", "asm['_compile_all_enq__']", "asm['_precompile_enq_all_specializations__']", "asm['_precompile_enq_all_cache__']", "asm['_precompile_enq_specialization_']", "asm['_jl_compile_hint']", "asm['_jl_subtype_env_size']", "asm['_jl_count_union_components']", "asm['_jl_nth_union_component']", "asm['_jl_instantiate_type_with']", "asm['_jl_has_concrete_subtype']", "asm['_jl_safepoint_init']", "asm['_libsupport_init']", "asm['_jl_set_io_wait']", "asm['___errno_location']", "asm['_strerror']", "_getenv", "asm['_dirname']", "asm['_abspath']", "asm['_snprintf']", "asm['_jl_cwd']", "asm['_jl_preload_sysimg_so']", "asm['_jl_getpagesize']", "asm['_getrlimit']", "asm['_jl_init_threading']", "asm['_jl_gc_init']", "asm['_jl_gc_enable']", "asm['_jl_init_types']", "asm['_jl_init_frontend']", "asm['_jl_init_tasks']", "asm['_jl_init_root_task']", "asm['_jl_alloc_vec_any']", "asm['_jl_init_serializer']", "asm['_jl_init_intrinsic_properties']", "asm['_jl_new_module']", "asm['_jl_init_intrinsic_functions']", "asm['_jl_init_primitives']", "asm['_jl_get_builtins']", "asm['_jl_init_main_module']", "asm['_jl_load']", "asm['_jl_get_builtin_hooks']", "asm['_jl_init_box_caches']", "asm['_jl_restore_system_image']", "asm['_jl_exit']", "asm['_jl_add_standard_imports']", "asm['_jl_module_run_initializer']", "asm['_jl_bitcast']", "asm['_jl_neg_int']", "asm['_jl_add_int']", "asm['_jl_sub_int']", "asm['_jl_mul_int']", "asm['_jl_sdiv_int']", "asm['_jl_udiv_int']", "asm['_jl_srem_int']", "asm['_jl_urem_int']", "asm['_jl_add_ptr']", "asm['_jl_sub_ptr']", "asm['_jl_neg_float']", "asm['_jl_add_float']", "asm['_jl_sub_float']", "asm['_jl_mul_float']", "asm['_jl_div_float']", "asm['_jl_rem_float']", "asm['_jl_fma_float']", "asm['_jl_muladd_float']", "asm['_jl_eq_int']", "asm['_jl_ne_int']", "asm['_jl_slt_int']", "asm['_jl_ult_int']", "asm['_jl_sle_int']", "asm['_jl_ule_int']", "asm['_jl_eq_float']", "asm['_jl_ne_float']", "asm['_jl_lt_float']", "asm['_jl_le_float']", "asm['_jl_fpiseq']", "asm['_jl_fpislt']", "asm['_jl_and_int']", "asm['_jl_or_int']", "asm['_jl_xor_int']", "asm['_jl_not_int']", "asm['_jl_shl_int']", "asm['_jl_lshr_int']", "asm['_jl_ashr_int']", "asm['_jl_bswap_int']", "asm['_jl_ctpop_int']", "asm['_jl_ctlz_int']", "asm['_jl_cttz_int']", "asm['_jl_sext_int']", "asm['_jl_zext_int']", "asm['_jl_trunc_int']", "asm['_jl_fptoui']", "asm['_jl_fptosi']", "asm['_jl_uitofp']", "asm['_jl_sitofp']", "asm['_jl_fptrunc']", "asm['_jl_fpext']", "asm['_jl_checked_sadd_int']", "asm['_jl_checked_uadd_int']", "asm['_jl_checked_ssub_int']", "asm['_jl_checked_usub_int']", "asm['_jl_checked_smul_int']", "asm['_jl_checked_umul_int']", "asm['_jl_checked_sdiv_int']", "asm['_jl_checked_udiv_int']", "asm['_jl_checked_srem_int']", "asm['_jl_checked_urem_int']", "asm['_jl_abs_float']", "asm['_jl_copysign_float']", "asm['_jl_flipsign_int']", "asm['_jl_ceil_llvm']", "asm['_jl_floor_llvm']", "asm['_jl_trunc_llvm']", "asm['_jl_rint_llvm']", "asm['_jl_sqrt_llvm']", "asm['_jl_pointerref']", "asm['_jl_pointerset']", "asm['_jl_cglobal']", "asm['_jl_arraylen']", "asm['_jl_cglobal_auto']", "asm['_jl_safe_printf']", "asm['_jl_']", "asm['_fmt_fp']", "asm['_pop_arg_long_double']", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"];
var debug_table_i = [];
var debug_table_ii = [];
var debug_table_iidiiii = [];
var debug_table_iii = [];
var debug_table_iiii = [];
var debug_table_iiiii = [];
var debug_table_iiiiii = [];
var debug_table_iiiiiii = [];
var debug_table_iiiiiiii = [];
var debug_table_iiiiiiiiii = [];
var debug_table_v = [];
var debug_table_vi = [];
var debug_table_vii = [];
var debug_table_viii = [];
var debug_table_viiii = [];
function nullFunc_X(x) { err("Invalid function pointer '" + x + "' called with signature 'X'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: i: " + debug_table_i[x] + "  v: " + debug_table_v[x] + "  ii: " + debug_table_ii[x] + "  vi: " + debug_table_vi[x] + "  iii: " + debug_table_iii[x] + "  vii: " + debug_table_vii[x] + "  iiii: " + debug_table_iiii[x] + "  viii: " + debug_table_viii[x] + "  iiiii: " + debug_table_iiiii[x] + "  viiii: " + debug_table_viiii[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  "); abort(x) }

function nullFunc_i(x) { err("Invalid function pointer '" + x + "' called with signature 'i'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: ii: " + debug_table_ii[x] + "  iii: " + debug_table_iii[x] + "  iiii: " + debug_table_iiii[x] + "  iiiii: " + debug_table_iiiii[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  vi: " + debug_table_vi[x] + "  X: " + debug_table_X[x] + "  v: " + debug_table_v[x] + "  vii: " + debug_table_vii[x] + "  viii: " + debug_table_viii[x] + "  viiii: " + debug_table_viiii[x] + "  "); abort(x) }

function nullFunc_ii(x) { err("Invalid function pointer '" + x + "' called with signature 'ii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: i: " + debug_table_i[x] + "  iii: " + debug_table_iii[x] + "  iiii: " + debug_table_iiii[x] + "  iiiii: " + debug_table_iiiii[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  vii: " + debug_table_vii[x] + "  vi: " + debug_table_vi[x] + "  viii: " + debug_table_viii[x] + "  X: " + debug_table_X[x] + "  v: " + debug_table_v[x] + "  viiii: " + debug_table_viiii[x] + "  "); abort(x) }

function nullFunc_iidiiii(x) { err("Invalid function pointer '" + x + "' called with signature 'iidiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: ii: " + debug_table_ii[x] + "  i: " + debug_table_i[x] + "  iiii: " + debug_table_iiii[x] + "  iii: " + debug_table_iii[x] + "  iiiii: " + debug_table_iiiii[x] + "  viiii: " + debug_table_viiii[x] + "  viii: " + debug_table_viii[x] + "  vii: " + debug_table_vii[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  vi: " + debug_table_vi[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  X: " + debug_table_X[x] + "  v: " + debug_table_v[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  "); abort(x) }

function nullFunc_iii(x) { err("Invalid function pointer '" + x + "' called with signature 'iii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: ii: " + debug_table_ii[x] + "  iiii: " + debug_table_iiii[x] + "  i: " + debug_table_i[x] + "  iiiii: " + debug_table_iiiii[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  viii: " + debug_table_viii[x] + "  vii: " + debug_table_vii[x] + "  vi: " + debug_table_vi[x] + "  viiii: " + debug_table_viiii[x] + "  X: " + debug_table_X[x] + "  v: " + debug_table_v[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  "); abort(x) }

function nullFunc_iiii(x) { err("Invalid function pointer '" + x + "' called with signature 'iiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: iii: " + debug_table_iii[x] + "  ii: " + debug_table_ii[x] + "  iiiii: " + debug_table_iiiii[x] + "  i: " + debug_table_i[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  viii: " + debug_table_viii[x] + "  viiii: " + debug_table_viiii[x] + "  vii: " + debug_table_vii[x] + "  vi: " + debug_table_vi[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  X: " + debug_table_X[x] + "  v: " + debug_table_v[x] + "  "); abort(x) }

function nullFunc_iiiii(x) { err("Invalid function pointer '" + x + "' called with signature 'iiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: iiii: " + debug_table_iiii[x] + "  iii: " + debug_table_iii[x] + "  ii: " + debug_table_ii[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  i: " + debug_table_i[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  viiii: " + debug_table_viiii[x] + "  viii: " + debug_table_viii[x] + "  vii: " + debug_table_vii[x] + "  vi: " + debug_table_vi[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  X: " + debug_table_X[x] + "  v: " + debug_table_v[x] + "  "); abort(x) }

function nullFunc_iiiiii(x) { err("Invalid function pointer '" + x + "' called with signature 'iiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: iiii: " + debug_table_iiii[x] + "  iiiii: " + debug_table_iiiii[x] + "  iii: " + debug_table_iii[x] + "  ii: " + debug_table_ii[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  i: " + debug_table_i[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  viiii: " + debug_table_viiii[x] + "  viii: " + debug_table_viii[x] + "  vii: " + debug_table_vii[x] + "  vi: " + debug_table_vi[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  X: " + debug_table_X[x] + "  v: " + debug_table_v[x] + "  "); abort(x) }

function nullFunc_iiiiiii(x) { err("Invalid function pointer '" + x + "' called with signature 'iiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: iiii: " + debug_table_iiii[x] + "  iiiii: " + debug_table_iiiii[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  iii: " + debug_table_iii[x] + "  ii: " + debug_table_ii[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  i: " + debug_table_i[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  viiii: " + debug_table_viiii[x] + "  viii: " + debug_table_viii[x] + "  vii: " + debug_table_vii[x] + "  vi: " + debug_table_vi[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  X: " + debug_table_X[x] + "  v: " + debug_table_v[x] + "  "); abort(x) }

function nullFunc_iiiiiiii(x) { err("Invalid function pointer '" + x + "' called with signature 'iiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: iiii: " + debug_table_iiii[x] + "  iiiii: " + debug_table_iiiii[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  iii: " + debug_table_iii[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  ii: " + debug_table_ii[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  i: " + debug_table_i[x] + "  viiii: " + debug_table_viiii[x] + "  viii: " + debug_table_viii[x] + "  vii: " + debug_table_vii[x] + "  vi: " + debug_table_vi[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  X: " + debug_table_X[x] + "  v: " + debug_table_v[x] + "  "); abort(x) }

function nullFunc_iiiiiiiiii(x) { err("Invalid function pointer '" + x + "' called with signature 'iiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: iiiii: " + debug_table_iiiii[x] + "  iiii: " + debug_table_iiii[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  iii: " + debug_table_iii[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  ii: " + debug_table_ii[x] + "  i: " + debug_table_i[x] + "  viiii: " + debug_table_viiii[x] + "  viii: " + debug_table_viii[x] + "  vii: " + debug_table_vii[x] + "  vi: " + debug_table_vi[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  X: " + debug_table_X[x] + "  v: " + debug_table_v[x] + "  "); abort(x) }

function nullFunc_v(x) { err("Invalid function pointer '" + x + "' called with signature 'v'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: vi: " + debug_table_vi[x] + "  vii: " + debug_table_vii[x] + "  viii: " + debug_table_viii[x] + "  viiii: " + debug_table_viiii[x] + "  X: " + debug_table_X[x] + "  i: " + debug_table_i[x] + "  ii: " + debug_table_ii[x] + "  iii: " + debug_table_iii[x] + "  iiii: " + debug_table_iiii[x] + "  iiiii: " + debug_table_iiiii[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  "); abort(x) }

function nullFunc_vi(x) { err("Invalid function pointer '" + x + "' called with signature 'vi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: v: " + debug_table_v[x] + "  vii: " + debug_table_vii[x] + "  viii: " + debug_table_viii[x] + "  viiii: " + debug_table_viiii[x] + "  i: " + debug_table_i[x] + "  ii: " + debug_table_ii[x] + "  iii: " + debug_table_iii[x] + "  X: " + debug_table_X[x] + "  iiii: " + debug_table_iiii[x] + "  iiiii: " + debug_table_iiiii[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  "); abort(x) }

function nullFunc_vii(x) { err("Invalid function pointer '" + x + "' called with signature 'vii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: vi: " + debug_table_vi[x] + "  viii: " + debug_table_viii[x] + "  v: " + debug_table_v[x] + "  viiii: " + debug_table_viiii[x] + "  ii: " + debug_table_ii[x] + "  iii: " + debug_table_iii[x] + "  i: " + debug_table_i[x] + "  iiii: " + debug_table_iiii[x] + "  iiiii: " + debug_table_iiiii[x] + "  X: " + debug_table_X[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  "); abort(x) }

function nullFunc_viii(x) { err("Invalid function pointer '" + x + "' called with signature 'viii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: vii: " + debug_table_vii[x] + "  vi: " + debug_table_vi[x] + "  viiii: " + debug_table_viiii[x] + "  v: " + debug_table_v[x] + "  iii: " + debug_table_iii[x] + "  ii: " + debug_table_ii[x] + "  iiii: " + debug_table_iiii[x] + "  iiiii: " + debug_table_iiiii[x] + "  i: " + debug_table_i[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  X: " + debug_table_X[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  "); abort(x) }

function nullFunc_viiii(x) { err("Invalid function pointer '" + x + "' called with signature 'viiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");  err("This pointer might make sense in another type signature: viii: " + debug_table_viii[x] + "  vii: " + debug_table_vii[x] + "  vi: " + debug_table_vi[x] + "  v: " + debug_table_v[x] + "  iiii: " + debug_table_iiii[x] + "  iii: " + debug_table_iii[x] + "  ii: " + debug_table_ii[x] + "  iiiii: " + debug_table_iiiii[x] + "  iiiiii: " + debug_table_iiiiii[x] + "  i: " + debug_table_i[x] + "  iiiiiii: " + debug_table_iiiiiii[x] + "  iidiiii: " + debug_table_iidiiii[x] + "  X: " + debug_table_X[x] + "  iiiiiiii: " + debug_table_iiiiiiii[x] + "  iiiiiiiiii: " + debug_table_iiiiiiiiii[x] + "  "); abort(x) }
var gb = GLOBAL_BASE, fb = 0;
var g$__ZTVN4llvm18raw_string_ostreamE = function() {
  assert(Module["__ZTVN4llvm18raw_string_ostreamE"], "external global `__ZTVN4llvm18raw_string_ostreamE` is missing.perhaps a side module was not linked in? if this symbol was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module["__ZTVN4llvm18raw_string_ostreamE"];
}
var g$___gmp_bits_per_limb = function() {
  assert(Module["___gmp_bits_per_limb"], "external global `___gmp_bits_per_limb` is missing.perhaps a side module was not linked in? if this symbol was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module["___gmp_bits_per_limb"];
}
var g$___gmp_version = function() {
  assert(Module["___gmp_version"], "external global `___gmp_version` is missing.perhaps a side module was not linked in? if this symbol was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment");
  return Module["___gmp_version"];
}

function invoke_i(index) {
  var sp = stackSave();
  try {
    return dynCall_i(index);
  } catch(e) {
    stackRestore(sp);
    if (e !== e+0 && e !== 'longjmp') throw e;
    _setThrew(1, 0);
  }
}

function invoke_ii(index,a1) {
  var sp = stackSave();
  try {
    return dynCall_ii(index,a1);
  } catch(e) {
    stackRestore(sp);
    if (e !== e+0 && e !== 'longjmp') throw e;
    _setThrew(1, 0);
  }
}

function invoke_iii(index,a1,a2) {
  var sp = stackSave();
  try {
    return dynCall_iii(index,a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (e !== e+0 && e !== 'longjmp') throw e;
    _setThrew(1, 0);
  }
}

function invoke_iiii(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    return dynCall_iiii(index,a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (e !== e+0 && e !== 'longjmp') throw e;
    _setThrew(1, 0);
  }
}

function invoke_iiiii(index,a1,a2,a3,a4) {
  var sp = stackSave();
  try {
    return dynCall_iiiii(index,a1,a2,a3,a4);
  } catch(e) {
    stackRestore(sp);
    if (e !== e+0 && e !== 'longjmp') throw e;
    _setThrew(1, 0);
  }
}

function invoke_iiiiii(index,a1,a2,a3,a4,a5) {
  var sp = stackSave();
  try {
    return dynCall_iiiiii(index,a1,a2,a3,a4,a5);
  } catch(e) {
    stackRestore(sp);
    if (e !== e+0 && e !== 'longjmp') throw e;
    _setThrew(1, 0);
  }
}

function invoke_iiiiiiii(index,a1,a2,a3,a4,a5,a6,a7) {
  var sp = stackSave();
  try {
    return dynCall_iiiiiiii(index,a1,a2,a3,a4,a5,a6,a7);
  } catch(e) {
    stackRestore(sp);
    if (e !== e+0 && e !== 'longjmp') throw e;
    _setThrew(1, 0);
  }
}

function invoke_iiiiiiiiii(index,a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  var sp = stackSave();
  try {
    return dynCall_iiiiiiiiii(index,a1,a2,a3,a4,a5,a6,a7,a8,a9);
  } catch(e) {
    stackRestore(sp);
    if (e !== e+0 && e !== 'longjmp') throw e;
    _setThrew(1, 0);
  }
}

function invoke_v(index) {
  var sp = stackSave();
  try {
    dynCall_v(index);
  } catch(e) {
    stackRestore(sp);
    if (e !== e+0 && e !== 'longjmp') throw e;
    _setThrew(1, 0);
  }
}

function invoke_vi(index,a1) {
  var sp = stackSave();
  try {
    dynCall_vi(index,a1);
  } catch(e) {
    stackRestore(sp);
    if (e !== e+0 && e !== 'longjmp') throw e;
    _setThrew(1, 0);
  }
}

function invoke_vii(index,a1,a2) {
  var sp = stackSave();
  try {
    dynCall_vii(index,a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (e !== e+0 && e !== 'longjmp') throw e;
    _setThrew(1, 0);
  }
}

function invoke_viii(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    dynCall_viii(index,a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (e !== e+0 && e !== 'longjmp') throw e;
    _setThrew(1, 0);
  }
}

function invoke_viiii(index,a1,a2,a3,a4) {
  var sp = stackSave();
  try {
    dynCall_viiii(index,a1,a2,a3,a4);
  } catch(e) {
    stackRestore(sp);
    if (e !== e+0 && e !== 'longjmp') throw e;
    _setThrew(1, 0);
  }
}

function jsCall_X(index) {
    return functionPointers[index]();
}

function jsCall_i(index) {
    return functionPointers[index]();
}

function jsCall_ii(index,a1) {
    return functionPointers[index](a1);
}

function jsCall_iidiiii(index,a1,a2,a3,a4,a5,a6) {
    return functionPointers[index](a1,a2,a3,a4,a5,a6);
}

function jsCall_iii(index,a1,a2) {
    return functionPointers[index](a1,a2);
}

function jsCall_iiii(index,a1,a2,a3) {
    return functionPointers[index](a1,a2,a3);
}

function jsCall_iiiii(index,a1,a2,a3,a4) {
    return functionPointers[index](a1,a2,a3,a4);
}

function jsCall_iiiiii(index,a1,a2,a3,a4,a5) {
    return functionPointers[index](a1,a2,a3,a4,a5);
}

function jsCall_iiiiiii(index,a1,a2,a3,a4,a5,a6) {
    return functionPointers[index](a1,a2,a3,a4,a5,a6);
}

function jsCall_iiiiiiii(index,a1,a2,a3,a4,a5,a6,a7) {
    return functionPointers[index](a1,a2,a3,a4,a5,a6,a7);
}

function jsCall_iiiiiiiiii(index,a1,a2,a3,a4,a5,a6,a7,a8,a9) {
    return functionPointers[index](a1,a2,a3,a4,a5,a6,a7,a8,a9);
}

function jsCall_v(index) {
    functionPointers[index]();
}

function jsCall_vi(index,a1) {
    functionPointers[index](a1);
}

function jsCall_vii(index,a1,a2) {
    functionPointers[index](a1,a2);
}

function jsCall_viii(index,a1,a2,a3) {
    functionPointers[index](a1,a2,a3);
}

function jsCall_viiii(index,a1,a2,a3,a4) {
    functionPointers[index](a1,a2,a3,a4);
}


function dynCall_X(index) {
  index = index|0;
  
  return mftCall_X(index);
}


function jsCall_X_0() {
  
  return jsCall_X(0);
}



function jsCall_X_1() {
  
  return jsCall_X(1);
}



function jsCall_X_2() {
  
  return jsCall_X(2);
}



function jsCall_X_3() {
  
  return jsCall_X(3);
}



function jsCall_X_4() {
  
  return jsCall_X(4);
}



function jsCall_X_5() {
  
  return jsCall_X(5);
}



function jsCall_X_6() {
  
  return jsCall_X(6);
}



function jsCall_X_7() {
  
  return jsCall_X(7);
}



function jsCall_X_8() {
  
  return jsCall_X(8);
}



function jsCall_X_9() {
  
  return jsCall_X(9);
}



function jsCall_X_10() {
  
  return jsCall_X(10);
}



function jsCall_X_11() {
  
  return jsCall_X(11);
}



function jsCall_X_12() {
  
  return jsCall_X(12);
}



function jsCall_X_13() {
  
  return jsCall_X(13);
}



function jsCall_X_14() {
  
  return jsCall_X(14);
}



function jsCall_X_15() {
  
  return jsCall_X(15);
}



function jsCall_X_16() {
  
  return jsCall_X(16);
}



function jsCall_X_17() {
  
  return jsCall_X(17);
}



function jsCall_X_18() {
  
  return jsCall_X(18);
}



function jsCall_X_19() {
  
  return jsCall_X(19);
}



function dynCall_i(index) {
  index = index|0;
  
  return mftCall_i(index)|0;
}


function jsCall_i_0() {
  
  return jsCall_i(0)|0;
}



function jsCall_i_1() {
  
  return jsCall_i(1)|0;
}



function jsCall_i_2() {
  
  return jsCall_i(2)|0;
}



function jsCall_i_3() {
  
  return jsCall_i(3)|0;
}



function jsCall_i_4() {
  
  return jsCall_i(4)|0;
}



function jsCall_i_5() {
  
  return jsCall_i(5)|0;
}



function jsCall_i_6() {
  
  return jsCall_i(6)|0;
}



function jsCall_i_7() {
  
  return jsCall_i(7)|0;
}



function jsCall_i_8() {
  
  return jsCall_i(8)|0;
}



function jsCall_i_9() {
  
  return jsCall_i(9)|0;
}



function jsCall_i_10() {
  
  return jsCall_i(10)|0;
}



function jsCall_i_11() {
  
  return jsCall_i(11)|0;
}



function jsCall_i_12() {
  
  return jsCall_i(12)|0;
}



function jsCall_i_13() {
  
  return jsCall_i(13)|0;
}



function jsCall_i_14() {
  
  return jsCall_i(14)|0;
}



function jsCall_i_15() {
  
  return jsCall_i(15)|0;
}



function jsCall_i_16() {
  
  return jsCall_i(16)|0;
}



function jsCall_i_17() {
  
  return jsCall_i(17)|0;
}



function jsCall_i_18() {
  
  return jsCall_i(18)|0;
}



function jsCall_i_19() {
  
  return jsCall_i(19)|0;
}



function dynCall_ii(index,a1) {
  index = index|0;
  a1=a1|0;
  return mftCall_ii(index,a1|0)|0;
}


function jsCall_ii_0(a1) {
  a1=a1|0;
  return jsCall_ii(0,a1|0)|0;
}



function jsCall_ii_1(a1) {
  a1=a1|0;
  return jsCall_ii(1,a1|0)|0;
}



function jsCall_ii_2(a1) {
  a1=a1|0;
  return jsCall_ii(2,a1|0)|0;
}



function jsCall_ii_3(a1) {
  a1=a1|0;
  return jsCall_ii(3,a1|0)|0;
}



function jsCall_ii_4(a1) {
  a1=a1|0;
  return jsCall_ii(4,a1|0)|0;
}



function jsCall_ii_5(a1) {
  a1=a1|0;
  return jsCall_ii(5,a1|0)|0;
}



function jsCall_ii_6(a1) {
  a1=a1|0;
  return jsCall_ii(6,a1|0)|0;
}



function jsCall_ii_7(a1) {
  a1=a1|0;
  return jsCall_ii(7,a1|0)|0;
}



function jsCall_ii_8(a1) {
  a1=a1|0;
  return jsCall_ii(8,a1|0)|0;
}



function jsCall_ii_9(a1) {
  a1=a1|0;
  return jsCall_ii(9,a1|0)|0;
}



function jsCall_ii_10(a1) {
  a1=a1|0;
  return jsCall_ii(10,a1|0)|0;
}



function jsCall_ii_11(a1) {
  a1=a1|0;
  return jsCall_ii(11,a1|0)|0;
}



function jsCall_ii_12(a1) {
  a1=a1|0;
  return jsCall_ii(12,a1|0)|0;
}



function jsCall_ii_13(a1) {
  a1=a1|0;
  return jsCall_ii(13,a1|0)|0;
}



function jsCall_ii_14(a1) {
  a1=a1|0;
  return jsCall_ii(14,a1|0)|0;
}



function jsCall_ii_15(a1) {
  a1=a1|0;
  return jsCall_ii(15,a1|0)|0;
}



function jsCall_ii_16(a1) {
  a1=a1|0;
  return jsCall_ii(16,a1|0)|0;
}



function jsCall_ii_17(a1) {
  a1=a1|0;
  return jsCall_ii(17,a1|0)|0;
}



function jsCall_ii_18(a1) {
  a1=a1|0;
  return jsCall_ii(18,a1|0)|0;
}



function jsCall_ii_19(a1) {
  a1=a1|0;
  return jsCall_ii(19,a1|0)|0;
}



function dynCall_iidiiii(index,a1,a2,a3,a4,a5,a6) {
  index = index|0;
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return mftCall_iidiiii(index,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}


function jsCall_iidiiii_0(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(0,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_1(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(1,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_2(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(2,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_3(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(3,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_4(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(4,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_5(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(5,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_6(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(6,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_7(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(7,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_8(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(8,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_9(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(9,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_10(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(10,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_11(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(11,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_12(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(12,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_13(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(13,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_14(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(14,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_15(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(15,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_16(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(16,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_17(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(17,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_18(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(18,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iidiiii_19(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=+a2; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iidiiii(19,a1|0,+a2,a3|0,a4|0,a5|0,a6|0)|0;
}



function dynCall_iii(index,a1,a2) {
  index = index|0;
  a1=a1|0; a2=a2|0;
  return mftCall_iii(index,a1|0,a2|0)|0;
}


function jsCall_iii_0(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(0,a1|0,a2|0)|0;
}



function jsCall_iii_1(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(1,a1|0,a2|0)|0;
}



function jsCall_iii_2(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(2,a1|0,a2|0)|0;
}



function jsCall_iii_3(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(3,a1|0,a2|0)|0;
}



function jsCall_iii_4(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(4,a1|0,a2|0)|0;
}



function jsCall_iii_5(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(5,a1|0,a2|0)|0;
}



function jsCall_iii_6(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(6,a1|0,a2|0)|0;
}



function jsCall_iii_7(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(7,a1|0,a2|0)|0;
}



function jsCall_iii_8(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(8,a1|0,a2|0)|0;
}



function jsCall_iii_9(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(9,a1|0,a2|0)|0;
}



function jsCall_iii_10(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(10,a1|0,a2|0)|0;
}



function jsCall_iii_11(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(11,a1|0,a2|0)|0;
}



function jsCall_iii_12(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(12,a1|0,a2|0)|0;
}



function jsCall_iii_13(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(13,a1|0,a2|0)|0;
}



function jsCall_iii_14(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(14,a1|0,a2|0)|0;
}



function jsCall_iii_15(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(15,a1|0,a2|0)|0;
}



function jsCall_iii_16(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(16,a1|0,a2|0)|0;
}



function jsCall_iii_17(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(17,a1|0,a2|0)|0;
}



function jsCall_iii_18(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(18,a1|0,a2|0)|0;
}



function jsCall_iii_19(a1,a2) {
  a1=a1|0; a2=a2|0;
  return jsCall_iii(19,a1|0,a2|0)|0;
}



function dynCall_iiii(index,a1,a2,a3) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0;
  return mftCall_iiii(index,a1|0,a2|0,a3|0)|0;
}


function jsCall_iiii_0(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(0,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_1(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(1,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_2(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(2,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_3(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(3,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_4(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(4,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_5(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(5,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_6(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(6,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_7(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(7,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_8(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(8,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_9(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(9,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_10(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(10,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_11(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(11,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_12(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(12,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_13(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(13,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_14(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(14,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_15(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(15,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_16(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(16,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_17(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(17,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_18(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(18,a1|0,a2|0,a3|0)|0;
}



function jsCall_iiii_19(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  return jsCall_iiii(19,a1|0,a2|0,a3|0)|0;
}



function dynCall_iiiii(index,a1,a2,a3,a4) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return mftCall_iiiii(index,a1|0,a2|0,a3|0,a4|0)|0;
}


function jsCall_iiiii_0(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(0,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_1(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(1,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_2(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(2,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_3(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(3,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_4(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(4,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_5(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(5,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_6(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(6,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_7(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(7,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_8(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(8,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_9(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(9,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_10(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(10,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_11(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(11,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_12(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(12,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_13(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(13,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_14(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(14,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_15(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(15,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_16(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(16,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_17(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(17,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_18(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(18,a1|0,a2|0,a3|0,a4|0)|0;
}



function jsCall_iiiii_19(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  return jsCall_iiiii(19,a1|0,a2|0,a3|0,a4|0)|0;
}



function dynCall_iiiiii(index,a1,a2,a3,a4,a5) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return mftCall_iiiiii(index,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}


function jsCall_iiiiii_0(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(0,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_1(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(1,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_2(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(2,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_3(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(3,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_4(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(4,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_5(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(5,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_6(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(6,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_7(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(7,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_8(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(8,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_9(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(9,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_10(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(10,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_11(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(11,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_12(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(12,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_13(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(13,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_14(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(14,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_15(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(15,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_16(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(16,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_17(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(17,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_18(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(18,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function jsCall_iiiiii_19(a1,a2,a3,a4,a5) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  return jsCall_iiiiii(19,a1|0,a2|0,a3|0,a4|0,a5|0)|0;
}



function dynCall_iiiiiii(index,a1,a2,a3,a4,a5,a6) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return mftCall_iiiiiii(index,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}


function jsCall_iiiiiii_0(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(0,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_1(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(1,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_2(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(2,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_3(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(3,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_4(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(4,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_5(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(5,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_6(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(6,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_7(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(7,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_8(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(8,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_9(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(9,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_10(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(10,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_11(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(11,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_12(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(12,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_13(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(13,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_14(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(14,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_15(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(15,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_16(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(16,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_17(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(17,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_18(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(18,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function jsCall_iiiiiii_19(a1,a2,a3,a4,a5,a6) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  return jsCall_iiiiiii(19,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0)|0;
}



function dynCall_iiiiiiii(index,a1,a2,a3,a4,a5,a6,a7) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return mftCall_iiiiiiii(index,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}


function jsCall_iiiiiiii_0(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(0,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_1(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(1,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_2(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(2,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_3(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(3,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_4(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(4,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_5(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(5,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_6(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(6,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_7(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(7,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_8(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(8,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_9(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(9,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_10(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(10,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_11(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(11,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_12(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(12,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_13(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(13,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_14(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(14,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_15(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(15,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_16(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(16,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_17(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(17,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_18(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(18,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function jsCall_iiiiiiii_19(a1,a2,a3,a4,a5,a6,a7) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0;
  return jsCall_iiiiiiii(19,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0)|0;
}



function dynCall_iiiiiiiiii(index,a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return mftCall_iiiiiiiiii(index,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}


function jsCall_iiiiiiiiii_0(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(0,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_1(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(1,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_2(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(2,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_3(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(3,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_4(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(4,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_5(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(5,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_6(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(6,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_7(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(7,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_8(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(8,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_9(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(9,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_10(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(10,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_11(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(11,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_12(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(12,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_13(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(13,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_14(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(14,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_15(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(15,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_16(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(16,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_17(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(17,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_18(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(18,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function jsCall_iiiiiiiiii_19(a1,a2,a3,a4,a5,a6,a7,a8,a9) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0; a7=a7|0; a8=a8|0; a9=a9|0;
  return jsCall_iiiiiiiiii(19,a1|0,a2|0,a3|0,a4|0,a5|0,a6|0,a7|0,a8|0,a9|0)|0;
}



function dynCall_v(index) {
  index = index|0;
  
  mftCall_v(index);
}


function jsCall_v_0() {
  
  jsCall_v(0);
}



function jsCall_v_1() {
  
  jsCall_v(1);
}



function jsCall_v_2() {
  
  jsCall_v(2);
}



function jsCall_v_3() {
  
  jsCall_v(3);
}



function jsCall_v_4() {
  
  jsCall_v(4);
}



function jsCall_v_5() {
  
  jsCall_v(5);
}



function jsCall_v_6() {
  
  jsCall_v(6);
}



function jsCall_v_7() {
  
  jsCall_v(7);
}



function jsCall_v_8() {
  
  jsCall_v(8);
}



function jsCall_v_9() {
  
  jsCall_v(9);
}



function jsCall_v_10() {
  
  jsCall_v(10);
}



function jsCall_v_11() {
  
  jsCall_v(11);
}



function jsCall_v_12() {
  
  jsCall_v(12);
}



function jsCall_v_13() {
  
  jsCall_v(13);
}



function jsCall_v_14() {
  
  jsCall_v(14);
}



function jsCall_v_15() {
  
  jsCall_v(15);
}



function jsCall_v_16() {
  
  jsCall_v(16);
}



function jsCall_v_17() {
  
  jsCall_v(17);
}



function jsCall_v_18() {
  
  jsCall_v(18);
}



function jsCall_v_19() {
  
  jsCall_v(19);
}



function dynCall_vi(index,a1) {
  index = index|0;
  a1=a1|0;
  mftCall_vi(index,a1|0);
}


function jsCall_vi_0(a1) {
  a1=a1|0;
  jsCall_vi(0,a1|0);
}



function jsCall_vi_1(a1) {
  a1=a1|0;
  jsCall_vi(1,a1|0);
}



function jsCall_vi_2(a1) {
  a1=a1|0;
  jsCall_vi(2,a1|0);
}



function jsCall_vi_3(a1) {
  a1=a1|0;
  jsCall_vi(3,a1|0);
}



function jsCall_vi_4(a1) {
  a1=a1|0;
  jsCall_vi(4,a1|0);
}



function jsCall_vi_5(a1) {
  a1=a1|0;
  jsCall_vi(5,a1|0);
}



function jsCall_vi_6(a1) {
  a1=a1|0;
  jsCall_vi(6,a1|0);
}



function jsCall_vi_7(a1) {
  a1=a1|0;
  jsCall_vi(7,a1|0);
}



function jsCall_vi_8(a1) {
  a1=a1|0;
  jsCall_vi(8,a1|0);
}



function jsCall_vi_9(a1) {
  a1=a1|0;
  jsCall_vi(9,a1|0);
}



function jsCall_vi_10(a1) {
  a1=a1|0;
  jsCall_vi(10,a1|0);
}



function jsCall_vi_11(a1) {
  a1=a1|0;
  jsCall_vi(11,a1|0);
}



function jsCall_vi_12(a1) {
  a1=a1|0;
  jsCall_vi(12,a1|0);
}



function jsCall_vi_13(a1) {
  a1=a1|0;
  jsCall_vi(13,a1|0);
}



function jsCall_vi_14(a1) {
  a1=a1|0;
  jsCall_vi(14,a1|0);
}



function jsCall_vi_15(a1) {
  a1=a1|0;
  jsCall_vi(15,a1|0);
}



function jsCall_vi_16(a1) {
  a1=a1|0;
  jsCall_vi(16,a1|0);
}



function jsCall_vi_17(a1) {
  a1=a1|0;
  jsCall_vi(17,a1|0);
}



function jsCall_vi_18(a1) {
  a1=a1|0;
  jsCall_vi(18,a1|0);
}



function jsCall_vi_19(a1) {
  a1=a1|0;
  jsCall_vi(19,a1|0);
}



function dynCall_vii(index,a1,a2) {
  index = index|0;
  a1=a1|0; a2=a2|0;
  mftCall_vii(index,a1|0,a2|0);
}


function jsCall_vii_0(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(0,a1|0,a2|0);
}



function jsCall_vii_1(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(1,a1|0,a2|0);
}



function jsCall_vii_2(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(2,a1|0,a2|0);
}



function jsCall_vii_3(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(3,a1|0,a2|0);
}



function jsCall_vii_4(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(4,a1|0,a2|0);
}



function jsCall_vii_5(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(5,a1|0,a2|0);
}



function jsCall_vii_6(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(6,a1|0,a2|0);
}



function jsCall_vii_7(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(7,a1|0,a2|0);
}



function jsCall_vii_8(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(8,a1|0,a2|0);
}



function jsCall_vii_9(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(9,a1|0,a2|0);
}



function jsCall_vii_10(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(10,a1|0,a2|0);
}



function jsCall_vii_11(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(11,a1|0,a2|0);
}



function jsCall_vii_12(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(12,a1|0,a2|0);
}



function jsCall_vii_13(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(13,a1|0,a2|0);
}



function jsCall_vii_14(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(14,a1|0,a2|0);
}



function jsCall_vii_15(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(15,a1|0,a2|0);
}



function jsCall_vii_16(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(16,a1|0,a2|0);
}



function jsCall_vii_17(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(17,a1|0,a2|0);
}



function jsCall_vii_18(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(18,a1|0,a2|0);
}



function jsCall_vii_19(a1,a2) {
  a1=a1|0; a2=a2|0;
  jsCall_vii(19,a1|0,a2|0);
}



function dynCall_viii(index,a1,a2,a3) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0;
  mftCall_viii(index,a1|0,a2|0,a3|0);
}


function jsCall_viii_0(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(0,a1|0,a2|0,a3|0);
}



function jsCall_viii_1(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(1,a1|0,a2|0,a3|0);
}



function jsCall_viii_2(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(2,a1|0,a2|0,a3|0);
}



function jsCall_viii_3(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(3,a1|0,a2|0,a3|0);
}



function jsCall_viii_4(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(4,a1|0,a2|0,a3|0);
}



function jsCall_viii_5(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(5,a1|0,a2|0,a3|0);
}



function jsCall_viii_6(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(6,a1|0,a2|0,a3|0);
}



function jsCall_viii_7(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(7,a1|0,a2|0,a3|0);
}



function jsCall_viii_8(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(8,a1|0,a2|0,a3|0);
}



function jsCall_viii_9(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(9,a1|0,a2|0,a3|0);
}



function jsCall_viii_10(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(10,a1|0,a2|0,a3|0);
}



function jsCall_viii_11(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(11,a1|0,a2|0,a3|0);
}



function jsCall_viii_12(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(12,a1|0,a2|0,a3|0);
}



function jsCall_viii_13(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(13,a1|0,a2|0,a3|0);
}



function jsCall_viii_14(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(14,a1|0,a2|0,a3|0);
}



function jsCall_viii_15(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(15,a1|0,a2|0,a3|0);
}



function jsCall_viii_16(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(16,a1|0,a2|0,a3|0);
}



function jsCall_viii_17(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(17,a1|0,a2|0,a3|0);
}



function jsCall_viii_18(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(18,a1|0,a2|0,a3|0);
}



function jsCall_viii_19(a1,a2,a3) {
  a1=a1|0; a2=a2|0; a3=a3|0;
  jsCall_viii(19,a1|0,a2|0,a3|0);
}



function dynCall_viiii(index,a1,a2,a3,a4) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  mftCall_viiii(index,a1|0,a2|0,a3|0,a4|0);
}


function jsCall_viiii_0(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(0,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_1(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(1,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_2(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(2,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_3(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(3,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_4(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(4,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_5(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(5,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_6(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(6,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_7(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(7,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_8(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(8,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_9(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(9,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_10(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(10,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_11(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(11,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_12(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(12,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_13(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(13,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_14(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(14,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_15(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(15,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_16(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(16,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_17(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(17,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_18(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(18,a1|0,a2|0,a3|0,a4|0);
}



function jsCall_viiii_19(a1,a2,a3,a4) {
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  jsCall_viiii(19,a1|0,a2|0,a3|0,a4|0);
}



var asmGlobalArg = {}

var asmLibraryArg = {
  "abort": abort,
  "setTempRet0": setTempRet0,
  "getTempRet0": getTempRet0,
  "abortStackOverflow": abortStackOverflow,
  "nullFunc_X": nullFunc_X,
  "nullFunc_i": nullFunc_i,
  "nullFunc_ii": nullFunc_ii,
  "nullFunc_iidiiii": nullFunc_iidiiii,
  "nullFunc_iii": nullFunc_iii,
  "nullFunc_iiii": nullFunc_iiii,
  "nullFunc_iiiii": nullFunc_iiiii,
  "nullFunc_iiiiii": nullFunc_iiiiii,
  "nullFunc_iiiiiii": nullFunc_iiiiiii,
  "nullFunc_iiiiiiii": nullFunc_iiiiiiii,
  "nullFunc_iiiiiiiiii": nullFunc_iiiiiiiiii,
  "nullFunc_v": nullFunc_v,
  "nullFunc_vi": nullFunc_vi,
  "nullFunc_vii": nullFunc_vii,
  "nullFunc_viii": nullFunc_viii,
  "nullFunc_viiii": nullFunc_viiii,
  "invoke_i": invoke_i,
  "invoke_ii": invoke_ii,
  "invoke_iii": invoke_iii,
  "invoke_iiii": invoke_iiii,
  "invoke_iiiii": invoke_iiiii,
  "invoke_iiiiii": invoke_iiiiii,
  "invoke_iiiiiiii": invoke_iiiiiiii,
  "invoke_iiiiiiiiii": invoke_iiiiiiiiii,
  "invoke_v": invoke_v,
  "invoke_vi": invoke_vi,
  "invoke_vii": invoke_vii,
  "invoke_viii": invoke_viii,
  "invoke_viiii": invoke_viiii,
  "jsCall_X": jsCall_X,
  "jsCall_i": jsCall_i,
  "jsCall_ii": jsCall_ii,
  "jsCall_iidiiii": jsCall_iidiiii,
  "jsCall_iii": jsCall_iii,
  "jsCall_iiii": jsCall_iiii,
  "jsCall_iiiii": jsCall_iiiii,
  "jsCall_iiiiii": jsCall_iiiiii,
  "jsCall_iiiiiii": jsCall_iiiiiii,
  "jsCall_iiiiiiii": jsCall_iiiiiiii,
  "jsCall_iiiiiiiiii": jsCall_iiiiiiiiii,
  "jsCall_v": jsCall_v,
  "jsCall_vi": jsCall_vi,
  "jsCall_vii": jsCall_vii,
  "jsCall_viii": jsCall_viii,
  "jsCall_viiii": jsCall_viiii,
  "__ZN4llvm11APFloatBase10IEEEdoubleEv": __ZN4llvm11APFloatBase10IEEEdoubleEv,
  "__ZN4llvm11APFloatBase15PPCDoubleDoubleEv": __ZN4llvm11APFloatBase15PPCDoubleDoubleEv,
  "__ZN4llvm11raw_ostream14flush_nonemptyEv": __ZN4llvm11raw_ostream14flush_nonemptyEv,
  "__ZN4llvm11raw_ostream5writeEPKcm": __ZN4llvm11raw_ostream5writeEPKcm,
  "__ZN4llvm11raw_ostream5writeEh": __ZN4llvm11raw_ostream5writeEh,
  "__ZN4llvm11raw_ostreamlsEl": __ZN4llvm11raw_ostreamlsEl,
  "__ZN4llvm18raw_string_ostreamD1Ev": __ZN4llvm18raw_string_ostreamD1Ev,
  "__ZN4llvm3sys14getHostCPUNameEv": __ZN4llvm3sys14getHostCPUNameEv,
  "__ZN4llvm3sys18getHostCPUFeaturesERNS_9StringMapIbNS_15MallocAllocatorEEE": __ZN4llvm3sys18getHostCPUFeaturesERNS_9StringMapIbNS_15MallocAllocatorEEE,
  "__ZN4llvm5APInt11ashrInPlaceERKS0_": __ZN4llvm5APInt11ashrInPlaceERKS0_,
  "__ZN4llvm5APInt11lshrInPlaceERKS0_": __ZN4llvm5APInt11lshrInPlaceERKS0_,
  "__ZN4llvm5APInt12initSlowCaseERKS0_": __ZN4llvm5APInt12initSlowCaseERKS0_,
  "__ZN4llvm5APInt12initSlowCaseEyb": __ZN4llvm5APInt12initSlowCaseEyb,
  "__ZN4llvm5APInt16OrAssignSlowCaseERKS0_": __ZN4llvm5APInt16OrAssignSlowCaseERKS0_,
  "__ZN4llvm5APInt17AndAssignSlowCaseERKS0_": __ZN4llvm5APInt17AndAssignSlowCaseERKS0_,
  "__ZN4llvm5APInt17XorAssignSlowCaseERKS0_": __ZN4llvm5APInt17XorAssignSlowCaseERKS0_,
  "__ZN4llvm5APInt19flipAllBitsSlowCaseEv": __ZN4llvm5APInt19flipAllBitsSlowCaseEv,
  "__ZN4llvm5APIntC1EjNS_8ArrayRefIyEE": __ZN4llvm5APIntC1EjNS_8ArrayRefIyEE,
  "__ZN4llvm5APIntlSERKS0_": __ZN4llvm5APIntlSERKS0_,
  "__ZN4llvm5APIntmIERKS0_": __ZN4llvm5APIntmIERKS0_,
  "__ZN4llvm5APIntmLERKS0_": __ZN4llvm5APIntmLERKS0_,
  "__ZN4llvm5APIntpLERKS0_": __ZN4llvm5APIntpLERKS0_,
  "__ZN4llvm6detail9IEEEFloatC1Ed": __ZN4llvm6detail9IEEEFloatC1Ed,
  "__ZN4llvm6detail9IEEEFloatD1Ev": __ZN4llvm6detail9IEEEFloatD1Ev,
  "__ZN4llvm7APFloat7StorageC1ENS_6detail9IEEEFloatERKNS_12fltSemanticsE": __ZN4llvm7APFloat7StorageC1ENS_6detail9IEEEFloatERKNS_12fltSemanticsE,
  "__ZNK4llvm5APInt13EqualSlowCaseERKS0_": __ZNK4llvm5APInt13EqualSlowCaseERKS0_,
  "__ZNK4llvm5APInt13compareSignedERKS0_": __ZNK4llvm5APInt13compareSignedERKS0_,
  "__ZNK4llvm5APInt13roundToDoubleEb": __ZNK4llvm5APInt13roundToDoubleEb,
  "__ZNK4llvm5APInt23countPopulationSlowCaseEv": __ZNK4llvm5APInt23countPopulationSlowCaseEv,
  "__ZNK4llvm5APInt25countLeadingZerosSlowCaseEv": __ZNK4llvm5APInt25countLeadingZerosSlowCaseEv,
  "__ZNK4llvm5APInt26countTrailingZerosSlowCaseEv": __ZNK4llvm5APInt26countTrailingZerosSlowCaseEv,
  "__ZNK4llvm5APInt4sremERKS0_": __ZNK4llvm5APInt4sremERKS0_,
  "__ZNK4llvm5APInt4udivERKS0_": __ZNK4llvm5APInt4udivERKS0_,
  "__ZNK4llvm5APInt4uremERKS0_": __ZNK4llvm5APInt4uremERKS0_,
  "__ZNK4llvm5APInt7compareERKS0_": __ZNK4llvm5APInt7compareERKS0_,
  "__ZNK4llvm5APInt7sadd_ovERKS0_Rb": __ZNK4llvm5APInt7sadd_ovERKS0_Rb,
  "__ZNK4llvm5APInt7sdiv_ovERKS0_Rb": __ZNK4llvm5APInt7sdiv_ovERKS0_Rb,
  "__ZNK4llvm5APInt7smul_ovERKS0_Rb": __ZNK4llvm5APInt7smul_ovERKS0_Rb,
  "__ZNK4llvm5APInt7ssub_ovERKS0_Rb": __ZNK4llvm5APInt7ssub_ovERKS0_Rb,
  "__ZNK4llvm5APInt7uadd_ovERKS0_Rb": __ZNK4llvm5APInt7uadd_ovERKS0_Rb,
  "__ZNK4llvm5APInt7umul_ovERKS0_Rb": __ZNK4llvm5APInt7umul_ovERKS0_Rb,
  "__ZNK4llvm5APInt7usub_ovERKS0_Rb": __ZNK4llvm5APInt7usub_ovERKS0_Rb,
  "__ZNK4llvm5APInt8byteSwapEv": __ZNK4llvm5APInt8byteSwapEv,
  "__ZNK4llvm6detail13DoubleAPFloat16convertToIntegerENS_15MutableArrayRefIyEEjbNS_11APFloatBase12roundingModeEPb": __ZNK4llvm6detail13DoubleAPFloat16convertToIntegerENS_15MutableArrayRefIyEEjbNS_11APFloatBase12roundingModeEPb,
  "__ZNK4llvm6detail9IEEEFloat16convertToIntegerENS_15MutableArrayRefIyEEjbNS_11APFloatBase12roundingModeEPb": __ZNK4llvm6detail9IEEEFloat16convertToIntegerENS_15MutableArrayRefIyEEjbNS_11APFloatBase12roundingModeEPb,
  "__ZTVN4llvm18raw_string_ostreamE": __ZTVN4llvm18raw_string_ostreamE,
  "___buildEnvironment": ___buildEnvironment,
  "___clock_gettime": ___clock_gettime,
  "___gmp_asprintf": ___gmp_asprintf,
  "___gmp_bits_per_limb": ___gmp_bits_per_limb,
  "___gmp_get_memory_functions": ___gmp_get_memory_functions,
  "___gmp_printf": ___gmp_printf,
  "___gmp_randclear": ___gmp_randclear,
  "___gmp_randinit": ___gmp_randinit,
  "___gmp_randinit_default": ___gmp_randinit_default,
  "___gmp_randinit_lc_2exp": ___gmp_randinit_lc_2exp,
  "___gmp_randinit_lc_2exp_size": ___gmp_randinit_lc_2exp_size,
  "___gmp_randinit_mt": ___gmp_randinit_mt,
  "___gmp_randinit_set": ___gmp_randinit_set,
  "___gmp_randseed": ___gmp_randseed,
  "___gmp_randseed_ui": ___gmp_randseed_ui,
  "___gmp_scanf": ___gmp_scanf,
  "___gmp_set_memory_functions": ___gmp_set_memory_functions,
  "___gmp_snprintf": ___gmp_snprintf,
  "___gmp_sprintf": ___gmp_sprintf,
  "___gmp_sscanf": ___gmp_sscanf,
  "___gmp_urandomb_ui": ___gmp_urandomb_ui,
  "___gmp_urandomm_ui": ___gmp_urandomm_ui,
  "___gmp_version": ___gmp_version,
  "___gmpf_abs": ___gmpf_abs,
  "___gmpf_add": ___gmpf_add,
  "___gmpf_add_ui": ___gmpf_add_ui,
  "___gmpf_ceil": ___gmpf_ceil,
  "___gmpf_clear": ___gmpf_clear,
  "___gmpf_clears": ___gmpf_clears,
  "___gmpf_cmp": ___gmpf_cmp,
  "___gmpf_cmp_d": ___gmpf_cmp_d,
  "___gmpf_cmp_si": ___gmpf_cmp_si,
  "___gmpf_cmp_ui": ___gmpf_cmp_ui,
  "___gmpf_cmp_z": ___gmpf_cmp_z,
  "___gmpf_div": ___gmpf_div,
  "___gmpf_div_2exp": ___gmpf_div_2exp,
  "___gmpf_div_ui": ___gmpf_div_ui,
  "___gmpf_dump": ___gmpf_dump,
  "___gmpf_eq": ___gmpf_eq,
  "___gmpf_fits_sint_p": ___gmpf_fits_sint_p,
  "___gmpf_fits_slong_p": ___gmpf_fits_slong_p,
  "___gmpf_fits_sshort_p": ___gmpf_fits_sshort_p,
  "___gmpf_fits_uint_p": ___gmpf_fits_uint_p,
  "___gmpf_fits_ulong_p": ___gmpf_fits_ulong_p,
  "___gmpf_fits_ushort_p": ___gmpf_fits_ushort_p,
  "___gmpf_floor": ___gmpf_floor,
  "___gmpf_get_d": ___gmpf_get_d,
  "___gmpf_get_d_2exp": ___gmpf_get_d_2exp,
  "___gmpf_get_default_prec": ___gmpf_get_default_prec,
  "___gmpf_get_prec": ___gmpf_get_prec,
  "___gmpf_get_si": ___gmpf_get_si,
  "___gmpf_get_str": ___gmpf_get_str,
  "___gmpf_get_ui": ___gmpf_get_ui,
  "___gmpf_init": ___gmpf_init,
  "___gmpf_init2": ___gmpf_init2,
  "___gmpf_init_set": ___gmpf_init_set,
  "___gmpf_init_set_d": ___gmpf_init_set_d,
  "___gmpf_init_set_si": ___gmpf_init_set_si,
  "___gmpf_init_set_str": ___gmpf_init_set_str,
  "___gmpf_init_set_ui": ___gmpf_init_set_ui,
  "___gmpf_inits": ___gmpf_inits,
  "___gmpf_integer_p": ___gmpf_integer_p,
  "___gmpf_mul": ___gmpf_mul,
  "___gmpf_mul_2exp": ___gmpf_mul_2exp,
  "___gmpf_mul_ui": ___gmpf_mul_ui,
  "___gmpf_neg": ___gmpf_neg,
  "___gmpf_pow_ui": ___gmpf_pow_ui,
  "___gmpf_random2": ___gmpf_random2,
  "___gmpf_reldiff": ___gmpf_reldiff,
  "___gmpf_set": ___gmpf_set,
  "___gmpf_set_d": ___gmpf_set_d,
  "___gmpf_set_default_prec": ___gmpf_set_default_prec,
  "___gmpf_set_prec": ___gmpf_set_prec,
  "___gmpf_set_prec_raw": ___gmpf_set_prec_raw,
  "___gmpf_set_q": ___gmpf_set_q,
  "___gmpf_set_si": ___gmpf_set_si,
  "___gmpf_set_str": ___gmpf_set_str,
  "___gmpf_set_ui": ___gmpf_set_ui,
  "___gmpf_set_z": ___gmpf_set_z,
  "___gmpf_size": ___gmpf_size,
  "___gmpf_sqrt": ___gmpf_sqrt,
  "___gmpf_sqrt_ui": ___gmpf_sqrt_ui,
  "___gmpf_sub": ___gmpf_sub,
  "___gmpf_sub_ui": ___gmpf_sub_ui,
  "___gmpf_swap": ___gmpf_swap,
  "___gmpf_trunc": ___gmpf_trunc,
  "___gmpf_ui_div": ___gmpf_ui_div,
  "___gmpf_ui_sub": ___gmpf_ui_sub,
  "___gmpf_urandomb": ___gmpf_urandomb,
  "___gmpn_add": ___gmpn_add,
  "___gmpn_add_1": ___gmpn_add_1,
  "___gmpn_add_n": ___gmpn_add_n,
  "___gmpn_addmul_1": ___gmpn_addmul_1,
  "___gmpn_and_n": ___gmpn_and_n,
  "___gmpn_andn_n": ___gmpn_andn_n,
  "___gmpn_cmp": ___gmpn_cmp,
  "___gmpn_cnd_add_n": ___gmpn_cnd_add_n,
  "___gmpn_cnd_sub_n": ___gmpn_cnd_sub_n,
  "___gmpn_cnd_swap": ___gmpn_cnd_swap,
  "___gmpn_com": ___gmpn_com,
  "___gmpn_copyd": ___gmpn_copyd,
  "___gmpn_copyi": ___gmpn_copyi,
  "___gmpn_div_qr_1": ___gmpn_div_qr_1,
  "___gmpn_div_qr_2": ___gmpn_div_qr_2,
  "___gmpn_divexact_1": ___gmpn_divexact_1,
  "___gmpn_divexact_by3c": ___gmpn_divexact_by3c,
  "___gmpn_divrem": ___gmpn_divrem,
  "___gmpn_divrem_1": ___gmpn_divrem_1,
  "___gmpn_divrem_2": ___gmpn_divrem_2,
  "___gmpn_gcd": ___gmpn_gcd,
  "___gmpn_gcd_1": ___gmpn_gcd_1,
  "___gmpn_gcdext": ___gmpn_gcdext,
  "___gmpn_gcdext_1": ___gmpn_gcdext_1,
  "___gmpn_get_str": ___gmpn_get_str,
  "___gmpn_hamdist": ___gmpn_hamdist,
  "___gmpn_ior_n": ___gmpn_ior_n,
  "___gmpn_iorn_n": ___gmpn_iorn_n,
  "___gmpn_lshift": ___gmpn_lshift,
  "___gmpn_mod_1": ___gmpn_mod_1,
  "___gmpn_mul": ___gmpn_mul,
  "___gmpn_mul_1": ___gmpn_mul_1,
  "___gmpn_mul_n": ___gmpn_mul_n,
  "___gmpn_nand_n": ___gmpn_nand_n,
  "___gmpn_neg": ___gmpn_neg,
  "___gmpn_nior_n": ___gmpn_nior_n,
  "___gmpn_perfect_power_p": ___gmpn_perfect_power_p,
  "___gmpn_perfect_square_p": ___gmpn_perfect_square_p,
  "___gmpn_popcount": ___gmpn_popcount,
  "___gmpn_pow_1": ___gmpn_pow_1,
  "___gmpn_preinv_mod_1": ___gmpn_preinv_mod_1,
  "___gmpn_random": ___gmpn_random,
  "___gmpn_random2": ___gmpn_random2,
  "___gmpn_rshift": ___gmpn_rshift,
  "___gmpn_scan0": ___gmpn_scan0,
  "___gmpn_scan1": ___gmpn_scan1,
  "___gmpn_sec_add_1": ___gmpn_sec_add_1,
  "___gmpn_sec_add_1_itch": ___gmpn_sec_add_1_itch,
  "___gmpn_sec_div_qr": ___gmpn_sec_div_qr,
  "___gmpn_sec_div_qr_itch": ___gmpn_sec_div_qr_itch,
  "___gmpn_sec_div_r": ___gmpn_sec_div_r,
  "___gmpn_sec_div_r_itch": ___gmpn_sec_div_r_itch,
  "___gmpn_sec_invert": ___gmpn_sec_invert,
  "___gmpn_sec_invert_itch": ___gmpn_sec_invert_itch,
  "___gmpn_sec_mul": ___gmpn_sec_mul,
  "___gmpn_sec_mul_itch": ___gmpn_sec_mul_itch,
  "___gmpn_sec_powm": ___gmpn_sec_powm,
  "___gmpn_sec_powm_itch": ___gmpn_sec_powm_itch,
  "___gmpn_sec_sqr": ___gmpn_sec_sqr,
  "___gmpn_sec_sqr_itch": ___gmpn_sec_sqr_itch,
  "___gmpn_sec_sub_1": ___gmpn_sec_sub_1,
  "___gmpn_sec_sub_1_itch": ___gmpn_sec_sub_1_itch,
  "___gmpn_sec_tabselect": ___gmpn_sec_tabselect,
  "___gmpn_set_str": ___gmpn_set_str,
  "___gmpn_sizeinbase": ___gmpn_sizeinbase,
  "___gmpn_sqr": ___gmpn_sqr,
  "___gmpn_sqrtrem": ___gmpn_sqrtrem,
  "___gmpn_sub": ___gmpn_sub,
  "___gmpn_sub_1": ___gmpn_sub_1,
  "___gmpn_sub_n": ___gmpn_sub_n,
  "___gmpn_submul_1": ___gmpn_submul_1,
  "___gmpn_tdiv_qr": ___gmpn_tdiv_qr,
  "___gmpn_xnor_n": ___gmpn_xnor_n,
  "___gmpn_xor_n": ___gmpn_xor_n,
  "___gmpn_zero": ___gmpn_zero,
  "___gmpn_zero_p": ___gmpn_zero_p,
  "___gmpq_abs": ___gmpq_abs,
  "___gmpq_add": ___gmpq_add,
  "___gmpq_canonicalize": ___gmpq_canonicalize,
  "___gmpq_clear": ___gmpq_clear,
  "___gmpq_clears": ___gmpq_clears,
  "___gmpq_cmp": ___gmpq_cmp,
  "___gmpq_cmp_si": ___gmpq_cmp_si,
  "___gmpq_cmp_ui": ___gmpq_cmp_ui,
  "___gmpq_cmp_z": ___gmpq_cmp_z,
  "___gmpq_div": ___gmpq_div,
  "___gmpq_div_2exp": ___gmpq_div_2exp,
  "___gmpq_equal": ___gmpq_equal,
  "___gmpq_get_d": ___gmpq_get_d,
  "___gmpq_get_den": ___gmpq_get_den,
  "___gmpq_get_num": ___gmpq_get_num,
  "___gmpq_get_str": ___gmpq_get_str,
  "___gmpq_init": ___gmpq_init,
  "___gmpq_inits": ___gmpq_inits,
  "___gmpq_inv": ___gmpq_inv,
  "___gmpq_mul": ___gmpq_mul,
  "___gmpq_mul_2exp": ___gmpq_mul_2exp,
  "___gmpq_neg": ___gmpq_neg,
  "___gmpq_set": ___gmpq_set,
  "___gmpq_set_d": ___gmpq_set_d,
  "___gmpq_set_den": ___gmpq_set_den,
  "___gmpq_set_f": ___gmpq_set_f,
  "___gmpq_set_num": ___gmpq_set_num,
  "___gmpq_set_si": ___gmpq_set_si,
  "___gmpq_set_str": ___gmpq_set_str,
  "___gmpq_set_ui": ___gmpq_set_ui,
  "___gmpq_set_z": ___gmpq_set_z,
  "___gmpq_sub": ___gmpq_sub,
  "___gmpq_swap": ___gmpq_swap,
  "___gmpz_2fac_ui": ___gmpz_2fac_ui,
  "___gmpz_abs": ___gmpz_abs,
  "___gmpz_add": ___gmpz_add,
  "___gmpz_add_ui": ___gmpz_add_ui,
  "___gmpz_addmul": ___gmpz_addmul,
  "___gmpz_addmul_ui": ___gmpz_addmul_ui,
  "___gmpz_and": ___gmpz_and,
  "___gmpz_array_init": ___gmpz_array_init,
  "___gmpz_bin_ui": ___gmpz_bin_ui,
  "___gmpz_bin_uiui": ___gmpz_bin_uiui,
  "___gmpz_cdiv_q": ___gmpz_cdiv_q,
  "___gmpz_cdiv_q_2exp": ___gmpz_cdiv_q_2exp,
  "___gmpz_cdiv_q_ui": ___gmpz_cdiv_q_ui,
  "___gmpz_cdiv_qr": ___gmpz_cdiv_qr,
  "___gmpz_cdiv_qr_ui": ___gmpz_cdiv_qr_ui,
  "___gmpz_cdiv_r": ___gmpz_cdiv_r,
  "___gmpz_cdiv_r_2exp": ___gmpz_cdiv_r_2exp,
  "___gmpz_cdiv_r_ui": ___gmpz_cdiv_r_ui,
  "___gmpz_cdiv_ui": ___gmpz_cdiv_ui,
  "___gmpz_clear": ___gmpz_clear,
  "___gmpz_clears": ___gmpz_clears,
  "___gmpz_clrbit": ___gmpz_clrbit,
  "___gmpz_cmp": ___gmpz_cmp,
  "___gmpz_cmp_d": ___gmpz_cmp_d,
  "___gmpz_cmp_si": ___gmpz_cmp_si,
  "___gmpz_cmp_ui": ___gmpz_cmp_ui,
  "___gmpz_cmpabs": ___gmpz_cmpabs,
  "___gmpz_cmpabs_d": ___gmpz_cmpabs_d,
  "___gmpz_cmpabs_ui": ___gmpz_cmpabs_ui,
  "___gmpz_com": ___gmpz_com,
  "___gmpz_combit": ___gmpz_combit,
  "___gmpz_congruent_2exp_p": ___gmpz_congruent_2exp_p,
  "___gmpz_congruent_p": ___gmpz_congruent_p,
  "___gmpz_congruent_ui_p": ___gmpz_congruent_ui_p,
  "___gmpz_divexact": ___gmpz_divexact,
  "___gmpz_divexact_ui": ___gmpz_divexact_ui,
  "___gmpz_divisible_2exp_p": ___gmpz_divisible_2exp_p,
  "___gmpz_divisible_p": ___gmpz_divisible_p,
  "___gmpz_divisible_ui_p": ___gmpz_divisible_ui_p,
  "___gmpz_dump": ___gmpz_dump,
  "___gmpz_export": ___gmpz_export,
  "___gmpz_fac_ui": ___gmpz_fac_ui,
  "___gmpz_fdiv_q": ___gmpz_fdiv_q,
  "___gmpz_fdiv_q_2exp": ___gmpz_fdiv_q_2exp,
  "___gmpz_fdiv_q_ui": ___gmpz_fdiv_q_ui,
  "___gmpz_fdiv_qr": ___gmpz_fdiv_qr,
  "___gmpz_fdiv_qr_ui": ___gmpz_fdiv_qr_ui,
  "___gmpz_fdiv_r": ___gmpz_fdiv_r,
  "___gmpz_fdiv_r_2exp": ___gmpz_fdiv_r_2exp,
  "___gmpz_fdiv_r_ui": ___gmpz_fdiv_r_ui,
  "___gmpz_fdiv_ui": ___gmpz_fdiv_ui,
  "___gmpz_fib2_ui": ___gmpz_fib2_ui,
  "___gmpz_fib_ui": ___gmpz_fib_ui,
  "___gmpz_fits_sint_p": ___gmpz_fits_sint_p,
  "___gmpz_fits_slong_p": ___gmpz_fits_slong_p,
  "___gmpz_fits_sshort_p": ___gmpz_fits_sshort_p,
  "___gmpz_fits_uint_p": ___gmpz_fits_uint_p,
  "___gmpz_fits_ulong_p": ___gmpz_fits_ulong_p,
  "___gmpz_fits_ushort_p": ___gmpz_fits_ushort_p,
  "___gmpz_gcd": ___gmpz_gcd,
  "___gmpz_gcd_ui": ___gmpz_gcd_ui,
  "___gmpz_gcdext": ___gmpz_gcdext,
  "___gmpz_get_d": ___gmpz_get_d,
  "___gmpz_get_d_2exp": ___gmpz_get_d_2exp,
  "___gmpz_get_si": ___gmpz_get_si,
  "___gmpz_get_str": ___gmpz_get_str,
  "___gmpz_get_ui": ___gmpz_get_ui,
  "___gmpz_getlimbn": ___gmpz_getlimbn,
  "___gmpz_hamdist": ___gmpz_hamdist,
  "___gmpz_import": ___gmpz_import,
  "___gmpz_init": ___gmpz_init,
  "___gmpz_init2": ___gmpz_init2,
  "___gmpz_init_set": ___gmpz_init_set,
  "___gmpz_init_set_d": ___gmpz_init_set_d,
  "___gmpz_init_set_si": ___gmpz_init_set_si,
  "___gmpz_init_set_str": ___gmpz_init_set_str,
  "___gmpz_init_set_ui": ___gmpz_init_set_ui,
  "___gmpz_inits": ___gmpz_inits,
  "___gmpz_invert": ___gmpz_invert,
  "___gmpz_ior": ___gmpz_ior,
  "___gmpz_jacobi": ___gmpz_jacobi,
  "___gmpz_kronecker_si": ___gmpz_kronecker_si,
  "___gmpz_kronecker_ui": ___gmpz_kronecker_ui,
  "___gmpz_lcm": ___gmpz_lcm,
  "___gmpz_lcm_ui": ___gmpz_lcm_ui,
  "___gmpz_limbs_finish": ___gmpz_limbs_finish,
  "___gmpz_limbs_modify": ___gmpz_limbs_modify,
  "___gmpz_limbs_read": ___gmpz_limbs_read,
  "___gmpz_limbs_write": ___gmpz_limbs_write,
  "___gmpz_lucnum2_ui": ___gmpz_lucnum2_ui,
  "___gmpz_lucnum_ui": ___gmpz_lucnum_ui,
  "___gmpz_mfac_uiui": ___gmpz_mfac_uiui,
  "___gmpz_millerrabin": ___gmpz_millerrabin,
  "___gmpz_mod": ___gmpz_mod,
  "___gmpz_mul": ___gmpz_mul,
  "___gmpz_mul_2exp": ___gmpz_mul_2exp,
  "___gmpz_mul_si": ___gmpz_mul_si,
  "___gmpz_mul_ui": ___gmpz_mul_ui,
  "___gmpz_neg": ___gmpz_neg,
  "___gmpz_nextprime": ___gmpz_nextprime,
  "___gmpz_perfect_power_p": ___gmpz_perfect_power_p,
  "___gmpz_perfect_square_p": ___gmpz_perfect_square_p,
  "___gmpz_popcount": ___gmpz_popcount,
  "___gmpz_pow_ui": ___gmpz_pow_ui,
  "___gmpz_powm": ___gmpz_powm,
  "___gmpz_powm_sec": ___gmpz_powm_sec,
  "___gmpz_powm_ui": ___gmpz_powm_ui,
  "___gmpz_primorial_ui": ___gmpz_primorial_ui,
  "___gmpz_probab_prime_p": ___gmpz_probab_prime_p,
  "___gmpz_random": ___gmpz_random,
  "___gmpz_random2": ___gmpz_random2,
  "___gmpz_realloc": ___gmpz_realloc,
  "___gmpz_realloc2": ___gmpz_realloc2,
  "___gmpz_remove": ___gmpz_remove,
  "___gmpz_roinit_n": ___gmpz_roinit_n,
  "___gmpz_root": ___gmpz_root,
  "___gmpz_rootrem": ___gmpz_rootrem,
  "___gmpz_rrandomb": ___gmpz_rrandomb,
  "___gmpz_scan0": ___gmpz_scan0,
  "___gmpz_scan1": ___gmpz_scan1,
  "___gmpz_set": ___gmpz_set,
  "___gmpz_set_d": ___gmpz_set_d,
  "___gmpz_set_f": ___gmpz_set_f,
  "___gmpz_set_q": ___gmpz_set_q,
  "___gmpz_set_si": ___gmpz_set_si,
  "___gmpz_set_str": ___gmpz_set_str,
  "___gmpz_set_ui": ___gmpz_set_ui,
  "___gmpz_setbit": ___gmpz_setbit,
  "___gmpz_si_kronecker": ___gmpz_si_kronecker,
  "___gmpz_size": ___gmpz_size,
  "___gmpz_sizeinbase": ___gmpz_sizeinbase,
  "___gmpz_sqrt": ___gmpz_sqrt,
  "___gmpz_sqrtrem": ___gmpz_sqrtrem,
  "___gmpz_sub": ___gmpz_sub,
  "___gmpz_sub_ui": ___gmpz_sub_ui,
  "___gmpz_submul": ___gmpz_submul,
  "___gmpz_submul_ui": ___gmpz_submul_ui,
  "___gmpz_swap": ___gmpz_swap,
  "___gmpz_tdiv_q": ___gmpz_tdiv_q,
  "___gmpz_tdiv_q_2exp": ___gmpz_tdiv_q_2exp,
  "___gmpz_tdiv_q_ui": ___gmpz_tdiv_q_ui,
  "___gmpz_tdiv_qr": ___gmpz_tdiv_qr,
  "___gmpz_tdiv_qr_ui": ___gmpz_tdiv_qr_ui,
  "___gmpz_tdiv_r": ___gmpz_tdiv_r,
  "___gmpz_tdiv_r_2exp": ___gmpz_tdiv_r_2exp,
  "___gmpz_tdiv_r_ui": ___gmpz_tdiv_r_ui,
  "___gmpz_tdiv_ui": ___gmpz_tdiv_ui,
  "___gmpz_tstbit": ___gmpz_tstbit,
  "___gmpz_ui_kronecker": ___gmpz_ui_kronecker,
  "___gmpz_ui_pow_ui": ___gmpz_ui_pow_ui,
  "___gmpz_ui_sub": ___gmpz_ui_sub,
  "___gmpz_urandomb": ___gmpz_urandomb,
  "___gmpz_urandomm": ___gmpz_urandomm,
  "___gmpz_xor": ___gmpz_xor,
  "___lock": ___lock,
  "___map_file": ___map_file,
  "___setErrNo": ___setErrNo,
  "___syscall12": ___syscall12,
  "___syscall122": ___syscall122,
  "___syscall125": ___syscall125,
  "___syscall140": ___syscall140,
  "___syscall142": ___syscall142,
  "___syscall146": ___syscall146,
  "___syscall181": ___syscall181,
  "___syscall183": ___syscall183,
  "___syscall191": ___syscall191,
  "___syscall192": ___syscall192,
  "___syscall194": ___syscall194,
  "___syscall195": ___syscall195,
  "___syscall196": ___syscall196,
  "___syscall197": ___syscall197,
  "___syscall20": ___syscall20,
  "___syscall219": ___syscall219,
  "___syscall221": ___syscall221,
  "___syscall3": ___syscall3,
  "___syscall340": ___syscall340,
  "___syscall38": ___syscall38,
  "___syscall4": ___syscall4,
  "___syscall5": ___syscall5,
  "___syscall54": ___syscall54,
  "___syscall6": ___syscall6,
  "___syscall85": ___syscall85,
  "___syscall91": ___syscall91,
  "___unlock": ___unlock,
  "___wait": ___wait,
  "_abort": _abort,
  "_clock_gettime": _clock_gettime,
  "_dladdr": _dladdr,
  "_dlclose": _dlclose,
  "_dlerror": _dlerror,
  "_dlinfo": _dlinfo,
  "_dlopen": _dlopen,
  "_dlsym": _dlsym,
  "_emscripten_get_heap_size": _emscripten_get_heap_size,
  "_emscripten_get_now": _emscripten_get_now,
  "_emscripten_get_now_is_monotonic": _emscripten_get_now_is_monotonic,
  "_emscripten_longjmp": _emscripten_longjmp,
  "_emscripten_memcpy_big": _emscripten_memcpy_big,
  "_emscripten_resize_heap": _emscripten_resize_heap,
  "_exit": _exit,
  "_getenv": _getenv,
  "_gettimeofday": _gettimeofday,
  "_i32_from_id": _i32_from_id,
  "_jl_deserialize_verify_header": _jl_deserialize_verify_header,
  "_jl_dump_fptr_asm": _jl_dump_fptr_asm,
  "_jl_threading_profile": _jl_threading_profile,
  "_llvm_copysign_f32": _llvm_copysign_f32,
  "_llvm_copysign_f64": _llvm_copysign_f64,
  "_llvm_cttz_i32": _llvm_cttz_i32,
  "_llvm_cttz_i64": _llvm_cttz_i64,
  "_llvm_fma_f32": _llvm_fma_f32,
  "_llvm_fma_f64": _llvm_fma_f64,
  "_llvm_frameaddress": _llvm_frameaddress,
  "_llvm_trunc_f32": _llvm_trunc_f32,
  "_llvm_trunc_f64": _llvm_trunc_f64,
  "_longjmp": _longjmp,
  "_mpfr_abs": _mpfr_abs,
  "_mpfr_acos": _mpfr_acos,
  "_mpfr_acosh": _mpfr_acosh,
  "_mpfr_add": _mpfr_add,
  "_mpfr_add_d": _mpfr_add_d,
  "_mpfr_add_q": _mpfr_add_q,
  "_mpfr_add_si": _mpfr_add_si,
  "_mpfr_add_ui": _mpfr_add_ui,
  "_mpfr_add_z": _mpfr_add_z,
  "_mpfr_agm": _mpfr_agm,
  "_mpfr_ai": _mpfr_ai,
  "_mpfr_asin": _mpfr_asin,
  "_mpfr_asinh": _mpfr_asinh,
  "_mpfr_asprintf": _mpfr_asprintf,
  "_mpfr_atan": _mpfr_atan,
  "_mpfr_atan2": _mpfr_atan2,
  "_mpfr_atanh": _mpfr_atanh,
  "_mpfr_beta": _mpfr_beta,
  "_mpfr_buildopt_decimal_p": _mpfr_buildopt_decimal_p,
  "_mpfr_buildopt_float128_p": _mpfr_buildopt_float128_p,
  "_mpfr_buildopt_gmpinternals_p": _mpfr_buildopt_gmpinternals_p,
  "_mpfr_buildopt_sharedcache_p": _mpfr_buildopt_sharedcache_p,
  "_mpfr_buildopt_tls_p": _mpfr_buildopt_tls_p,
  "_mpfr_buildopt_tune_case": _mpfr_buildopt_tune_case,
  "_mpfr_can_round": _mpfr_can_round,
  "_mpfr_cbrt": _mpfr_cbrt,
  "_mpfr_ceil": _mpfr_ceil,
  "_mpfr_check_range": _mpfr_check_range,
  "_mpfr_clear": _mpfr_clear,
  "_mpfr_clear_divby0": _mpfr_clear_divby0,
  "_mpfr_clear_erangeflag": _mpfr_clear_erangeflag,
  "_mpfr_clear_flags": _mpfr_clear_flags,
  "_mpfr_clear_inexflag": _mpfr_clear_inexflag,
  "_mpfr_clear_nanflag": _mpfr_clear_nanflag,
  "_mpfr_clear_overflow": _mpfr_clear_overflow,
  "_mpfr_clear_underflow": _mpfr_clear_underflow,
  "_mpfr_clears": _mpfr_clears,
  "_mpfr_cmp": _mpfr_cmp,
  "_mpfr_cmp3": _mpfr_cmp3,
  "_mpfr_cmp_d": _mpfr_cmp_d,
  "_mpfr_cmp_f": _mpfr_cmp_f,
  "_mpfr_cmp_ld": _mpfr_cmp_ld,
  "_mpfr_cmp_q": _mpfr_cmp_q,
  "_mpfr_cmp_si": _mpfr_cmp_si,
  "_mpfr_cmp_si_2exp": _mpfr_cmp_si_2exp,
  "_mpfr_cmp_ui": _mpfr_cmp_ui,
  "_mpfr_cmp_ui_2exp": _mpfr_cmp_ui_2exp,
  "_mpfr_cmp_z": _mpfr_cmp_z,
  "_mpfr_cmpabs": _mpfr_cmpabs,
  "_mpfr_const_catalan": _mpfr_const_catalan,
  "_mpfr_const_euler": _mpfr_const_euler,
  "_mpfr_const_log2": _mpfr_const_log2,
  "_mpfr_const_pi": _mpfr_const_pi,
  "_mpfr_copysign": _mpfr_copysign,
  "_mpfr_cos": _mpfr_cos,
  "_mpfr_cosh": _mpfr_cosh,
  "_mpfr_cot": _mpfr_cot,
  "_mpfr_coth": _mpfr_coth,
  "_mpfr_csc": _mpfr_csc,
  "_mpfr_csch": _mpfr_csch,
  "_mpfr_custom_get_exp": _mpfr_custom_get_exp,
  "_mpfr_custom_get_kind": _mpfr_custom_get_kind,
  "_mpfr_custom_get_significand": _mpfr_custom_get_significand,
  "_mpfr_custom_get_size": _mpfr_custom_get_size,
  "_mpfr_custom_init": _mpfr_custom_init,
  "_mpfr_custom_init_set": _mpfr_custom_init_set,
  "_mpfr_custom_move": _mpfr_custom_move,
  "_mpfr_d_div": _mpfr_d_div,
  "_mpfr_d_sub": _mpfr_d_sub,
  "_mpfr_digamma": _mpfr_digamma,
  "_mpfr_dim": _mpfr_dim,
  "_mpfr_div": _mpfr_div,
  "_mpfr_div_2exp": _mpfr_div_2exp,
  "_mpfr_div_2si": _mpfr_div_2si,
  "_mpfr_div_2ui": _mpfr_div_2ui,
  "_mpfr_div_d": _mpfr_div_d,
  "_mpfr_div_q": _mpfr_div_q,
  "_mpfr_div_si": _mpfr_div_si,
  "_mpfr_div_ui": _mpfr_div_ui,
  "_mpfr_div_z": _mpfr_div_z,
  "_mpfr_divby0_p": _mpfr_divby0_p,
  "_mpfr_dump": _mpfr_dump,
  "_mpfr_eint": _mpfr_eint,
  "_mpfr_eq": _mpfr_eq,
  "_mpfr_equal_p": _mpfr_equal_p,
  "_mpfr_erandom": _mpfr_erandom,
  "_mpfr_erangeflag_p": _mpfr_erangeflag_p,
  "_mpfr_erf": _mpfr_erf,
  "_mpfr_erfc": _mpfr_erfc,
  "_mpfr_exp": _mpfr_exp,
  "_mpfr_exp10": _mpfr_exp10,
  "_mpfr_exp2": _mpfr_exp2,
  "_mpfr_expm1": _mpfr_expm1,
  "_mpfr_extract": _mpfr_extract,
  "_mpfr_fac_ui": _mpfr_fac_ui,
  "_mpfr_fits_intmax_p": _mpfr_fits_intmax_p,
  "_mpfr_fits_sint_p": _mpfr_fits_sint_p,
  "_mpfr_fits_slong_p": _mpfr_fits_slong_p,
  "_mpfr_fits_sshort_p": _mpfr_fits_sshort_p,
  "_mpfr_fits_uint_p": _mpfr_fits_uint_p,
  "_mpfr_fits_uintmax_p": _mpfr_fits_uintmax_p,
  "_mpfr_fits_ulong_p": _mpfr_fits_ulong_p,
  "_mpfr_fits_ushort_p": _mpfr_fits_ushort_p,
  "_mpfr_flags_clear": _mpfr_flags_clear,
  "_mpfr_flags_restore": _mpfr_flags_restore,
  "_mpfr_flags_save": _mpfr_flags_save,
  "_mpfr_flags_set": _mpfr_flags_set,
  "_mpfr_flags_test": _mpfr_flags_test,
  "_mpfr_floor": _mpfr_floor,
  "_mpfr_fma": _mpfr_fma,
  "_mpfr_fmma": _mpfr_fmma,
  "_mpfr_fmms": _mpfr_fmms,
  "_mpfr_fmod": _mpfr_fmod,
  "_mpfr_fmodquo": _mpfr_fmodquo,
  "_mpfr_fms": _mpfr_fms,
  "_mpfr_frac": _mpfr_frac,
  "_mpfr_free_cache": _mpfr_free_cache,
  "_mpfr_free_cache2": _mpfr_free_cache2,
  "_mpfr_free_pool": _mpfr_free_pool,
  "_mpfr_free_str": _mpfr_free_str,
  "_mpfr_frexp": _mpfr_frexp,
  "_mpfr_gamma": _mpfr_gamma,
  "_mpfr_gamma_inc": _mpfr_gamma_inc,
  "_mpfr_get_d": _mpfr_get_d,
  "_mpfr_get_d1": _mpfr_get_d1,
  "_mpfr_get_d_2exp": _mpfr_get_d_2exp,
  "_mpfr_get_default_prec": _mpfr_get_default_prec,
  "_mpfr_get_default_rounding_mode": _mpfr_get_default_rounding_mode,
  "_mpfr_get_emax": _mpfr_get_emax,
  "_mpfr_get_emax_max": _mpfr_get_emax_max,
  "_mpfr_get_emax_min": _mpfr_get_emax_min,
  "_mpfr_get_emin": _mpfr_get_emin,
  "_mpfr_get_emin_max": _mpfr_get_emin_max,
  "_mpfr_get_emin_min": _mpfr_get_emin_min,
  "_mpfr_get_exp": _mpfr_get_exp,
  "_mpfr_get_f": _mpfr_get_f,
  "_mpfr_get_flt": _mpfr_get_flt,
  "_mpfr_get_ld": _mpfr_get_ld,
  "_mpfr_get_ld_2exp": _mpfr_get_ld_2exp,
  "_mpfr_get_patches": _mpfr_get_patches,
  "_mpfr_get_prec": _mpfr_get_prec,
  "_mpfr_get_q": _mpfr_get_q,
  "_mpfr_get_si": _mpfr_get_si,
  "_mpfr_get_str": _mpfr_get_str,
  "_mpfr_get_ui": _mpfr_get_ui,
  "_mpfr_get_version": _mpfr_get_version,
  "_mpfr_get_z": _mpfr_get_z,
  "_mpfr_get_z_2exp": _mpfr_get_z_2exp,
  "_mpfr_grandom": _mpfr_grandom,
  "_mpfr_greater_p": _mpfr_greater_p,
  "_mpfr_greaterequal_p": _mpfr_greaterequal_p,
  "_mpfr_hypot": _mpfr_hypot,
  "_mpfr_inexflag_p": _mpfr_inexflag_p,
  "_mpfr_inf_p": _mpfr_inf_p,
  "_mpfr_init": _mpfr_init,
  "_mpfr_init2": _mpfr_init2,
  "_mpfr_init_set_str": _mpfr_init_set_str,
  "_mpfr_inits": _mpfr_inits,
  "_mpfr_inits2": _mpfr_inits2,
  "_mpfr_integer_p": _mpfr_integer_p,
  "_mpfr_j0": _mpfr_j0,
  "_mpfr_j1": _mpfr_j1,
  "_mpfr_jn": _mpfr_jn,
  "_mpfr_less_p": _mpfr_less_p,
  "_mpfr_lessequal_p": _mpfr_lessequal_p,
  "_mpfr_lessgreater_p": _mpfr_lessgreater_p,
  "_mpfr_lgamma": _mpfr_lgamma,
  "_mpfr_li2": _mpfr_li2,
  "_mpfr_lngamma": _mpfr_lngamma,
  "_mpfr_log": _mpfr_log,
  "_mpfr_log10": _mpfr_log10,
  "_mpfr_log1p": _mpfr_log1p,
  "_mpfr_log2": _mpfr_log2,
  "_mpfr_log_ui": _mpfr_log_ui,
  "_mpfr_max": _mpfr_max,
  "_mpfr_min": _mpfr_min,
  "_mpfr_min_prec": _mpfr_min_prec,
  "_mpfr_modf": _mpfr_modf,
  "_mpfr_mp_memory_cleanup": _mpfr_mp_memory_cleanup,
  "_mpfr_mul": _mpfr_mul,
  "_mpfr_mul_2exp": _mpfr_mul_2exp,
  "_mpfr_mul_2si": _mpfr_mul_2si,
  "_mpfr_mul_2ui": _mpfr_mul_2ui,
  "_mpfr_mul_d": _mpfr_mul_d,
  "_mpfr_mul_q": _mpfr_mul_q,
  "_mpfr_mul_si": _mpfr_mul_si,
  "_mpfr_mul_ui": _mpfr_mul_ui,
  "_mpfr_mul_z": _mpfr_mul_z,
  "_mpfr_nan_p": _mpfr_nan_p,
  "_mpfr_nanflag_p": _mpfr_nanflag_p,
  "_mpfr_neg": _mpfr_neg,
  "_mpfr_nextabove": _mpfr_nextabove,
  "_mpfr_nextbelow": _mpfr_nextbelow,
  "_mpfr_nexttoward": _mpfr_nexttoward,
  "_mpfr_nrandom": _mpfr_nrandom,
  "_mpfr_number_p": _mpfr_number_p,
  "_mpfr_overflow_p": _mpfr_overflow_p,
  "_mpfr_pow": _mpfr_pow,
  "_mpfr_pow_si": _mpfr_pow_si,
  "_mpfr_pow_ui": _mpfr_pow_ui,
  "_mpfr_pow_z": _mpfr_pow_z,
  "_mpfr_prec_round": _mpfr_prec_round,
  "_mpfr_print_rnd_mode": _mpfr_print_rnd_mode,
  "_mpfr_printf": _mpfr_printf,
  "_mpfr_rec_sqrt": _mpfr_rec_sqrt,
  "_mpfr_regular_p": _mpfr_regular_p,
  "_mpfr_reldiff": _mpfr_reldiff,
  "_mpfr_remainder": _mpfr_remainder,
  "_mpfr_remquo": _mpfr_remquo,
  "_mpfr_rint": _mpfr_rint,
  "_mpfr_rint_ceil": _mpfr_rint_ceil,
  "_mpfr_rint_floor": _mpfr_rint_floor,
  "_mpfr_rint_round": _mpfr_rint_round,
  "_mpfr_rint_roundeven": _mpfr_rint_roundeven,
  "_mpfr_rint_trunc": _mpfr_rint_trunc,
  "_mpfr_root": _mpfr_root,
  "_mpfr_rootn_ui": _mpfr_rootn_ui,
  "_mpfr_round": _mpfr_round,
  "_mpfr_round_nearest_away_begin": _mpfr_round_nearest_away_begin,
  "_mpfr_round_nearest_away_end": _mpfr_round_nearest_away_end,
  "_mpfr_roundeven": _mpfr_roundeven,
  "_mpfr_sec": _mpfr_sec,
  "_mpfr_sech": _mpfr_sech,
  "_mpfr_set": _mpfr_set,
  "_mpfr_set4": _mpfr_set4,
  "_mpfr_set_d": _mpfr_set_d,
  "_mpfr_set_default_prec": _mpfr_set_default_prec,
  "_mpfr_set_default_rounding_mode": _mpfr_set_default_rounding_mode,
  "_mpfr_set_divby0": _mpfr_set_divby0,
  "_mpfr_set_emax": _mpfr_set_emax,
  "_mpfr_set_emin": _mpfr_set_emin,
  "_mpfr_set_erangeflag": _mpfr_set_erangeflag,
  "_mpfr_set_exp": _mpfr_set_exp,
  "_mpfr_set_f": _mpfr_set_f,
  "_mpfr_set_flt": _mpfr_set_flt,
  "_mpfr_set_inexflag": _mpfr_set_inexflag,
  "_mpfr_set_inf": _mpfr_set_inf,
  "_mpfr_set_ld": _mpfr_set_ld,
  "_mpfr_set_nan": _mpfr_set_nan,
  "_mpfr_set_nanflag": _mpfr_set_nanflag,
  "_mpfr_set_overflow": _mpfr_set_overflow,
  "_mpfr_set_prec": _mpfr_set_prec,
  "_mpfr_set_prec_raw": _mpfr_set_prec_raw,
  "_mpfr_set_q": _mpfr_set_q,
  "_mpfr_set_si": _mpfr_set_si,
  "_mpfr_set_si_2exp": _mpfr_set_si_2exp,
  "_mpfr_set_str": _mpfr_set_str,
  "_mpfr_set_ui": _mpfr_set_ui,
  "_mpfr_set_ui_2exp": _mpfr_set_ui_2exp,
  "_mpfr_set_underflow": _mpfr_set_underflow,
  "_mpfr_set_z": _mpfr_set_z,
  "_mpfr_set_z_2exp": _mpfr_set_z_2exp,
  "_mpfr_set_zero": _mpfr_set_zero,
  "_mpfr_setsign": _mpfr_setsign,
  "_mpfr_sgn": _mpfr_sgn,
  "_mpfr_si_div": _mpfr_si_div,
  "_mpfr_si_sub": _mpfr_si_sub,
  "_mpfr_signbit": _mpfr_signbit,
  "_mpfr_sin": _mpfr_sin,
  "_mpfr_sin_cos": _mpfr_sin_cos,
  "_mpfr_sinh": _mpfr_sinh,
  "_mpfr_sinh_cosh": _mpfr_sinh_cosh,
  "_mpfr_snprintf": _mpfr_snprintf,
  "_mpfr_sprintf": _mpfr_sprintf,
  "_mpfr_sqr": _mpfr_sqr,
  "_mpfr_sqrt": _mpfr_sqrt,
  "_mpfr_sqrt_ui": _mpfr_sqrt_ui,
  "_mpfr_strtofr": _mpfr_strtofr,
  "_mpfr_sub": _mpfr_sub,
  "_mpfr_sub_d": _mpfr_sub_d,
  "_mpfr_sub_q": _mpfr_sub_q,
  "_mpfr_sub_si": _mpfr_sub_si,
  "_mpfr_sub_ui": _mpfr_sub_ui,
  "_mpfr_sub_z": _mpfr_sub_z,
  "_mpfr_subnormalize": _mpfr_subnormalize,
  "_mpfr_sum": _mpfr_sum,
  "_mpfr_swap": _mpfr_swap,
  "_mpfr_tan": _mpfr_tan,
  "_mpfr_tanh": _mpfr_tanh,
  "_mpfr_trunc": _mpfr_trunc,
  "_mpfr_ui_div": _mpfr_ui_div,
  "_mpfr_ui_pow": _mpfr_ui_pow,
  "_mpfr_ui_pow_ui": _mpfr_ui_pow_ui,
  "_mpfr_ui_sub": _mpfr_ui_sub,
  "_mpfr_underflow_p": _mpfr_underflow_p,
  "_mpfr_unordered_p": _mpfr_unordered_p,
  "_mpfr_urandom": _mpfr_urandom,
  "_mpfr_urandomb": _mpfr_urandomb,
  "_mpfr_y0": _mpfr_y0,
  "_mpfr_y1": _mpfr_y1,
  "_mpfr_yn": _mpfr_yn,
  "_mpfr_z_sub": _mpfr_z_sub,
  "_mpfr_zero_p": _mpfr_zero_p,
  "_mpfr_zeta": _mpfr_zeta,
  "_mpfr_zeta_ui": _mpfr_zeta_ui,
  "_pcre2_code_copy_16": _pcre2_code_copy_16,
  "_pcre2_code_copy_32": _pcre2_code_copy_32,
  "_pcre2_code_copy_8": _pcre2_code_copy_8,
  "_pcre2_code_copy_with_tables_16": _pcre2_code_copy_with_tables_16,
  "_pcre2_code_copy_with_tables_32": _pcre2_code_copy_with_tables_32,
  "_pcre2_code_copy_with_tables_8": _pcre2_code_copy_with_tables_8,
  "_pcre2_code_free_16": _pcre2_code_free_16,
  "_pcre2_code_free_32": _pcre2_code_free_32,
  "_pcre2_code_free_8": _pcre2_code_free_8,
  "_pcre2_compile_16": _pcre2_compile_16,
  "_pcre2_compile_32": _pcre2_compile_32,
  "_pcre2_compile_8": _pcre2_compile_8,
  "_pcre2_compile_context_copy_16": _pcre2_compile_context_copy_16,
  "_pcre2_compile_context_copy_32": _pcre2_compile_context_copy_32,
  "_pcre2_compile_context_copy_8": _pcre2_compile_context_copy_8,
  "_pcre2_compile_context_create_16": _pcre2_compile_context_create_16,
  "_pcre2_compile_context_create_32": _pcre2_compile_context_create_32,
  "_pcre2_compile_context_create_8": _pcre2_compile_context_create_8,
  "_pcre2_compile_context_free_16": _pcre2_compile_context_free_16,
  "_pcre2_compile_context_free_32": _pcre2_compile_context_free_32,
  "_pcre2_compile_context_free_8": _pcre2_compile_context_free_8,
  "_pcre2_config_16": _pcre2_config_16,
  "_pcre2_config_32": _pcre2_config_32,
  "_pcre2_config_8": _pcre2_config_8,
  "_pcre2_convert_context_copy_16": _pcre2_convert_context_copy_16,
  "_pcre2_convert_context_copy_32": _pcre2_convert_context_copy_32,
  "_pcre2_convert_context_copy_8": _pcre2_convert_context_copy_8,
  "_pcre2_convert_context_create_16": _pcre2_convert_context_create_16,
  "_pcre2_convert_context_create_32": _pcre2_convert_context_create_32,
  "_pcre2_convert_context_create_8": _pcre2_convert_context_create_8,
  "_pcre2_convert_context_free_16": _pcre2_convert_context_free_16,
  "_pcre2_convert_context_free_32": _pcre2_convert_context_free_32,
  "_pcre2_convert_context_free_8": _pcre2_convert_context_free_8,
  "_pcre2_converted_pattern_free_16": _pcre2_converted_pattern_free_16,
  "_pcre2_converted_pattern_free_32": _pcre2_converted_pattern_free_32,
  "_pcre2_converted_pattern_free_8": _pcre2_converted_pattern_free_8,
  "_pcre2_dfa_match_16": _pcre2_dfa_match_16,
  "_pcre2_dfa_match_32": _pcre2_dfa_match_32,
  "_pcre2_dfa_match_8": _pcre2_dfa_match_8,
  "_pcre2_general_context_copy_16": _pcre2_general_context_copy_16,
  "_pcre2_general_context_copy_32": _pcre2_general_context_copy_32,
  "_pcre2_general_context_copy_8": _pcre2_general_context_copy_8,
  "_pcre2_general_context_create_16": _pcre2_general_context_create_16,
  "_pcre2_general_context_create_32": _pcre2_general_context_create_32,
  "_pcre2_general_context_create_8": _pcre2_general_context_create_8,
  "_pcre2_general_context_free_16": _pcre2_general_context_free_16,
  "_pcre2_general_context_free_32": _pcre2_general_context_free_32,
  "_pcre2_general_context_free_8": _pcre2_general_context_free_8,
  "_pcre2_get_error_message_16": _pcre2_get_error_message_16,
  "_pcre2_get_error_message_32": _pcre2_get_error_message_32,
  "_pcre2_get_error_message_8": _pcre2_get_error_message_8,
  "_pcre2_get_mark_16": _pcre2_get_mark_16,
  "_pcre2_get_mark_32": _pcre2_get_mark_32,
  "_pcre2_get_mark_8": _pcre2_get_mark_8,
  "_pcre2_get_ovector_count_16": _pcre2_get_ovector_count_16,
  "_pcre2_get_ovector_count_32": _pcre2_get_ovector_count_32,
  "_pcre2_get_ovector_count_8": _pcre2_get_ovector_count_8,
  "_pcre2_get_ovector_pointer_16": _pcre2_get_ovector_pointer_16,
  "_pcre2_get_ovector_pointer_32": _pcre2_get_ovector_pointer_32,
  "_pcre2_get_ovector_pointer_8": _pcre2_get_ovector_pointer_8,
  "_pcre2_get_startchar_16": _pcre2_get_startchar_16,
  "_pcre2_get_startchar_32": _pcre2_get_startchar_32,
  "_pcre2_get_startchar_8": _pcre2_get_startchar_8,
  "_pcre2_jit_compile_16": _pcre2_jit_compile_16,
  "_pcre2_jit_compile_32": _pcre2_jit_compile_32,
  "_pcre2_jit_compile_8": _pcre2_jit_compile_8,
  "_pcre2_jit_free_unused_memory_16": _pcre2_jit_free_unused_memory_16,
  "_pcre2_jit_free_unused_memory_32": _pcre2_jit_free_unused_memory_32,
  "_pcre2_jit_free_unused_memory_8": _pcre2_jit_free_unused_memory_8,
  "_pcre2_jit_match_16": _pcre2_jit_match_16,
  "_pcre2_jit_match_32": _pcre2_jit_match_32,
  "_pcre2_jit_match_8": _pcre2_jit_match_8,
  "_pcre2_jit_stack_assign_16": _pcre2_jit_stack_assign_16,
  "_pcre2_jit_stack_assign_32": _pcre2_jit_stack_assign_32,
  "_pcre2_jit_stack_assign_8": _pcre2_jit_stack_assign_8,
  "_pcre2_jit_stack_create_16": _pcre2_jit_stack_create_16,
  "_pcre2_jit_stack_create_32": _pcre2_jit_stack_create_32,
  "_pcre2_jit_stack_create_8": _pcre2_jit_stack_create_8,
  "_pcre2_jit_stack_free_16": _pcre2_jit_stack_free_16,
  "_pcre2_jit_stack_free_32": _pcre2_jit_stack_free_32,
  "_pcre2_jit_stack_free_8": _pcre2_jit_stack_free_8,
  "_pcre2_maketables_16": _pcre2_maketables_16,
  "_pcre2_maketables_32": _pcre2_maketables_32,
  "_pcre2_maketables_8": _pcre2_maketables_8,
  "_pcre2_match_16": _pcre2_match_16,
  "_pcre2_match_32": _pcre2_match_32,
  "_pcre2_match_8": _pcre2_match_8,
  "_pcre2_match_context_copy_16": _pcre2_match_context_copy_16,
  "_pcre2_match_context_copy_32": _pcre2_match_context_copy_32,
  "_pcre2_match_context_copy_8": _pcre2_match_context_copy_8,
  "_pcre2_match_context_create_16": _pcre2_match_context_create_16,
  "_pcre2_match_context_create_32": _pcre2_match_context_create_32,
  "_pcre2_match_context_create_8": _pcre2_match_context_create_8,
  "_pcre2_match_context_free_16": _pcre2_match_context_free_16,
  "_pcre2_match_context_free_32": _pcre2_match_context_free_32,
  "_pcre2_match_context_free_8": _pcre2_match_context_free_8,
  "_pcre2_match_data_create_16": _pcre2_match_data_create_16,
  "_pcre2_match_data_create_32": _pcre2_match_data_create_32,
  "_pcre2_match_data_create_8": _pcre2_match_data_create_8,
  "_pcre2_match_data_create_from_pattern_16": _pcre2_match_data_create_from_pattern_16,
  "_pcre2_match_data_create_from_pattern_32": _pcre2_match_data_create_from_pattern_32,
  "_pcre2_match_data_create_from_pattern_8": _pcre2_match_data_create_from_pattern_8,
  "_pcre2_match_data_free_16": _pcre2_match_data_free_16,
  "_pcre2_match_data_free_32": _pcre2_match_data_free_32,
  "_pcre2_match_data_free_8": _pcre2_match_data_free_8,
  "_pcre2_pattern_convert_16": _pcre2_pattern_convert_16,
  "_pcre2_pattern_convert_32": _pcre2_pattern_convert_32,
  "_pcre2_pattern_convert_8": _pcre2_pattern_convert_8,
  "_pcre2_pattern_info_16": _pcre2_pattern_info_16,
  "_pcre2_pattern_info_32": _pcre2_pattern_info_32,
  "_pcre2_pattern_info_8": _pcre2_pattern_info_8,
  "_pcre2_serialize_decode_16": _pcre2_serialize_decode_16,
  "_pcre2_serialize_decode_32": _pcre2_serialize_decode_32,
  "_pcre2_serialize_decode_8": _pcre2_serialize_decode_8,
  "_pcre2_serialize_encode_16": _pcre2_serialize_encode_16,
  "_pcre2_serialize_encode_32": _pcre2_serialize_encode_32,
  "_pcre2_serialize_encode_8": _pcre2_serialize_encode_8,
  "_pcre2_serialize_free_16": _pcre2_serialize_free_16,
  "_pcre2_serialize_free_32": _pcre2_serialize_free_32,
  "_pcre2_serialize_free_8": _pcre2_serialize_free_8,
  "_pcre2_serialize_get_number_of_codes_16": _pcre2_serialize_get_number_of_codes_16,
  "_pcre2_serialize_get_number_of_codes_32": _pcre2_serialize_get_number_of_codes_32,
  "_pcre2_serialize_get_number_of_codes_8": _pcre2_serialize_get_number_of_codes_8,
  "_pcre2_set_bsr_16": _pcre2_set_bsr_16,
  "_pcre2_set_bsr_32": _pcre2_set_bsr_32,
  "_pcre2_set_bsr_8": _pcre2_set_bsr_8,
  "_pcre2_set_character_tables_16": _pcre2_set_character_tables_16,
  "_pcre2_set_character_tables_32": _pcre2_set_character_tables_32,
  "_pcre2_set_character_tables_8": _pcre2_set_character_tables_8,
  "_pcre2_set_compile_extra_options_16": _pcre2_set_compile_extra_options_16,
  "_pcre2_set_compile_extra_options_32": _pcre2_set_compile_extra_options_32,
  "_pcre2_set_compile_extra_options_8": _pcre2_set_compile_extra_options_8,
  "_pcre2_set_compile_recursion_guard_16": _pcre2_set_compile_recursion_guard_16,
  "_pcre2_set_compile_recursion_guard_32": _pcre2_set_compile_recursion_guard_32,
  "_pcre2_set_compile_recursion_guard_8": _pcre2_set_compile_recursion_guard_8,
  "_pcre2_set_depth_limit_16": _pcre2_set_depth_limit_16,
  "_pcre2_set_depth_limit_32": _pcre2_set_depth_limit_32,
  "_pcre2_set_depth_limit_8": _pcre2_set_depth_limit_8,
  "_pcre2_set_glob_escape_16": _pcre2_set_glob_escape_16,
  "_pcre2_set_glob_escape_32": _pcre2_set_glob_escape_32,
  "_pcre2_set_glob_escape_8": _pcre2_set_glob_escape_8,
  "_pcre2_set_glob_separator_16": _pcre2_set_glob_separator_16,
  "_pcre2_set_glob_separator_32": _pcre2_set_glob_separator_32,
  "_pcre2_set_glob_separator_8": _pcre2_set_glob_separator_8,
  "_pcre2_set_heap_limit_16": _pcre2_set_heap_limit_16,
  "_pcre2_set_heap_limit_32": _pcre2_set_heap_limit_32,
  "_pcre2_set_heap_limit_8": _pcre2_set_heap_limit_8,
  "_pcre2_set_match_limit_16": _pcre2_set_match_limit_16,
  "_pcre2_set_match_limit_32": _pcre2_set_match_limit_32,
  "_pcre2_set_match_limit_8": _pcre2_set_match_limit_8,
  "_pcre2_set_max_pattern_length_16": _pcre2_set_max_pattern_length_16,
  "_pcre2_set_max_pattern_length_32": _pcre2_set_max_pattern_length_32,
  "_pcre2_set_max_pattern_length_8": _pcre2_set_max_pattern_length_8,
  "_pcre2_set_newline_16": _pcre2_set_newline_16,
  "_pcre2_set_newline_32": _pcre2_set_newline_32,
  "_pcre2_set_newline_8": _pcre2_set_newline_8,
  "_pcre2_set_offset_limit_16": _pcre2_set_offset_limit_16,
  "_pcre2_set_offset_limit_32": _pcre2_set_offset_limit_32,
  "_pcre2_set_offset_limit_8": _pcre2_set_offset_limit_8,
  "_pcre2_set_parens_nest_limit_16": _pcre2_set_parens_nest_limit_16,
  "_pcre2_set_parens_nest_limit_32": _pcre2_set_parens_nest_limit_32,
  "_pcre2_set_parens_nest_limit_8": _pcre2_set_parens_nest_limit_8,
  "_pcre2_set_recursion_limit_16": _pcre2_set_recursion_limit_16,
  "_pcre2_set_recursion_limit_32": _pcre2_set_recursion_limit_32,
  "_pcre2_set_recursion_limit_8": _pcre2_set_recursion_limit_8,
  "_pcre2_set_recursion_memory_management_16": _pcre2_set_recursion_memory_management_16,
  "_pcre2_set_recursion_memory_management_32": _pcre2_set_recursion_memory_management_32,
  "_pcre2_set_recursion_memory_management_8": _pcre2_set_recursion_memory_management_8,
  "_pcre2_substitute_16": _pcre2_substitute_16,
  "_pcre2_substitute_32": _pcre2_substitute_32,
  "_pcre2_substitute_8": _pcre2_substitute_8,
  "_pcre2_substring_copy_byname_16": _pcre2_substring_copy_byname_16,
  "_pcre2_substring_copy_byname_32": _pcre2_substring_copy_byname_32,
  "_pcre2_substring_copy_byname_8": _pcre2_substring_copy_byname_8,
  "_pcre2_substring_copy_bynumber_16": _pcre2_substring_copy_bynumber_16,
  "_pcre2_substring_copy_bynumber_32": _pcre2_substring_copy_bynumber_32,
  "_pcre2_substring_copy_bynumber_8": _pcre2_substring_copy_bynumber_8,
  "_pcre2_substring_free_16": _pcre2_substring_free_16,
  "_pcre2_substring_free_32": _pcre2_substring_free_32,
  "_pcre2_substring_free_8": _pcre2_substring_free_8,
  "_pcre2_substring_get_byname_16": _pcre2_substring_get_byname_16,
  "_pcre2_substring_get_byname_32": _pcre2_substring_get_byname_32,
  "_pcre2_substring_get_byname_8": _pcre2_substring_get_byname_8,
  "_pcre2_substring_get_bynumber_16": _pcre2_substring_get_bynumber_16,
  "_pcre2_substring_get_bynumber_32": _pcre2_substring_get_bynumber_32,
  "_pcre2_substring_get_bynumber_8": _pcre2_substring_get_bynumber_8,
  "_pcre2_substring_length_byname_16": _pcre2_substring_length_byname_16,
  "_pcre2_substring_length_byname_32": _pcre2_substring_length_byname_32,
  "_pcre2_substring_length_byname_8": _pcre2_substring_length_byname_8,
  "_pcre2_substring_length_bynumber_16": _pcre2_substring_length_bynumber_16,
  "_pcre2_substring_length_bynumber_32": _pcre2_substring_length_bynumber_32,
  "_pcre2_substring_length_bynumber_8": _pcre2_substring_length_bynumber_8,
  "_pcre2_substring_list_free_16": _pcre2_substring_list_free_16,
  "_pcre2_substring_list_free_32": _pcre2_substring_list_free_32,
  "_pcre2_substring_list_free_8": _pcre2_substring_list_free_8,
  "_pcre2_substring_list_get_16": _pcre2_substring_list_get_16,
  "_pcre2_substring_list_get_32": _pcre2_substring_list_get_32,
  "_pcre2_substring_list_get_8": _pcre2_substring_list_get_8,
  "_pcre2_substring_nametable_scan_16": _pcre2_substring_nametable_scan_16,
  "_pcre2_substring_nametable_scan_32": _pcre2_substring_nametable_scan_32,
  "_pcre2_substring_nametable_scan_8": _pcre2_substring_nametable_scan_8,
  "_pcre2_substring_number_from_name_16": _pcre2_substring_number_from_name_16,
  "_pcre2_substring_number_from_name_32": _pcre2_substring_number_from_name_32,
  "_pcre2_substring_number_from_name_8": _pcre2_substring_number_from_name_8,
  "_raise": _raise,
  "_setenv": _setenv,
  "_siglongjmp": _siglongjmp,
  "_string_from_id": _string_from_id,
  "_sysconf": _sysconf,
  "_timer_create": _timer_create,
  "_timer_delete": _timer_delete,
  "_timer_settime": _timer_settime,
  "_unsetenv": _unsetenv,
  "_update_id": _update_id,
  "_update_id0": _update_id0,
  "abortOnCannotGrowMemory": abortOnCannotGrowMemory,
  "emscripten_realloc_buffer": emscripten_realloc_buffer,
  "g$__ZTVN4llvm18raw_string_ostreamE": g$__ZTVN4llvm18raw_string_ostreamE,
  "g$___gmp_bits_per_limb": g$___gmp_bits_per_limb,
  "g$___gmp_version": g$___gmp_version,
  "tempDoublePtr": tempDoublePtr,
  "DYNAMICTOP_PTR": DYNAMICTOP_PTR,
  "gb": gb,
  "fb": fb,
  "STACKTOP": STACKTOP,
  "STACK_MAX": STACK_MAX
}
// EMSCRIPTEN_START_ASM
var asm =Module["asm"]// EMSCRIPTEN_END_ASM
(asmGlobalArg, asmLibraryArg, buffer);

var real____divdi3 = asm["___divdi3"]; asm["___divdi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____divdi3.apply(null, arguments);
};

var real____errno_location = asm["___errno_location"]; asm["___errno_location"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____errno_location.apply(null, arguments);
};

var real____muldi3 = asm["___muldi3"]; asm["___muldi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____muldi3.apply(null, arguments);
};

var real____remdi3 = asm["___remdi3"]; asm["___remdi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____remdi3.apply(null, arguments);
};

var real____udivdi3 = asm["___udivdi3"]; asm["___udivdi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____udivdi3.apply(null, arguments);
};

var real____uremdi3 = asm["___uremdi3"]; asm["___uremdi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real____uremdi3.apply(null, arguments);
};

var real___get_environ = asm["__get_environ"]; asm["__get_environ"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real___get_environ.apply(null, arguments);
};

var real__bitshift64Ashr = asm["_bitshift64Ashr"]; asm["_bitshift64Ashr"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__bitshift64Ashr.apply(null, arguments);
};

var real__bitshift64Lshr = asm["_bitshift64Lshr"]; asm["_bitshift64Lshr"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__bitshift64Lshr.apply(null, arguments);
};

var real__bitshift64Shl = asm["_bitshift64Shl"]; asm["_bitshift64Shl"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__bitshift64Shl.apply(null, arguments);
};

var real__fflush = asm["_fflush"]; asm["_fflush"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__fflush.apply(null, arguments);
};

var real__free = asm["_free"]; asm["_free"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__free.apply(null, arguments);
};

var real__i64Add = asm["_i64Add"]; asm["_i64Add"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__i64Add.apply(null, arguments);
};

var real__i64Subtract = asm["_i64Subtract"]; asm["_i64Subtract"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__i64Subtract.apply(null, arguments);
};

var real__init_lib = asm["_init_lib"]; asm["_init_lib"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__init_lib.apply(null, arguments);
};

var real__llvm_bswap_i32 = asm["_llvm_bswap_i32"]; asm["_llvm_bswap_i32"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__llvm_bswap_i32.apply(null, arguments);
};

var real__llvm_ctlz_i64 = asm["_llvm_ctlz_i64"]; asm["_llvm_ctlz_i64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__llvm_ctlz_i64.apply(null, arguments);
};

var real__llvm_ctpop_i64 = asm["_llvm_ctpop_i64"]; asm["_llvm_ctpop_i64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__llvm_ctpop_i64.apply(null, arguments);
};

var real__llvm_rint_f32 = asm["_llvm_rint_f32"]; asm["_llvm_rint_f32"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__llvm_rint_f32.apply(null, arguments);
};

var real__llvm_rint_f64 = asm["_llvm_rint_f64"]; asm["_llvm_rint_f64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__llvm_rint_f64.apply(null, arguments);
};

var real__malloc = asm["_malloc"]; asm["_malloc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__malloc.apply(null, arguments);
};

var real__memalign = asm["_memalign"]; asm["_memalign"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__memalign.apply(null, arguments);
};

var real__memmove = asm["_memmove"]; asm["_memmove"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__memmove.apply(null, arguments);
};

var real__realloc = asm["_realloc"]; asm["_realloc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__realloc.apply(null, arguments);
};

var real__runpage = asm["_runpage"]; asm["_runpage"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__runpage.apply(null, arguments);
};

var real__saveSetjmp = asm["_saveSetjmp"]; asm["_saveSetjmp"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__saveSetjmp.apply(null, arguments);
};

var real__sbrk = asm["_sbrk"]; asm["_sbrk"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__sbrk.apply(null, arguments);
};

var real__setThrew = asm["_setThrew"]; asm["_setThrew"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__setThrew.apply(null, arguments);
};

var real__testSetjmp = asm["_testSetjmp"]; asm["_testSetjmp"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real__testSetjmp.apply(null, arguments);
};

var real_establishStackSpace = asm["establishStackSpace"]; asm["establishStackSpace"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real_establishStackSpace.apply(null, arguments);
};

var real_globalCtors = asm["globalCtors"]; asm["globalCtors"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real_globalCtors.apply(null, arguments);
};

var real_stackAlloc = asm["stackAlloc"]; asm["stackAlloc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real_stackAlloc.apply(null, arguments);
};

var real_stackRestore = asm["stackRestore"]; asm["stackRestore"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real_stackRestore.apply(null, arguments);
};

var real_stackSave = asm["stackSave"]; asm["stackSave"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return real_stackSave.apply(null, arguments);
};
Module["asm"] = asm;
var ___divdi3 = Module["___divdi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["___divdi3"].apply(null, arguments) };
var ___errno_location = Module["___errno_location"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["___errno_location"].apply(null, arguments) };
var ___muldi3 = Module["___muldi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["___muldi3"].apply(null, arguments) };
var ___remdi3 = Module["___remdi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["___remdi3"].apply(null, arguments) };
var ___udivdi3 = Module["___udivdi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["___udivdi3"].apply(null, arguments) };
var ___uremdi3 = Module["___uremdi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["___uremdi3"].apply(null, arguments) };
var __get_environ = Module["__get_environ"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["__get_environ"].apply(null, arguments) };
var _bitshift64Ashr = Module["_bitshift64Ashr"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_bitshift64Ashr"].apply(null, arguments) };
var _bitshift64Lshr = Module["_bitshift64Lshr"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_bitshift64Lshr"].apply(null, arguments) };
var _bitshift64Shl = Module["_bitshift64Shl"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_bitshift64Shl"].apply(null, arguments) };
var _emscripten_replace_memory = Module["_emscripten_replace_memory"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_emscripten_replace_memory"].apply(null, arguments) };
var _fflush = Module["_fflush"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_fflush"].apply(null, arguments) };
var _free = Module["_free"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_free"].apply(null, arguments) };
var _i64Add = Module["_i64Add"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_i64Add"].apply(null, arguments) };
var _i64Subtract = Module["_i64Subtract"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_i64Subtract"].apply(null, arguments) };
var _init_lib = Module["_init_lib"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_init_lib"].apply(null, arguments) };
var _llvm_bswap_i32 = Module["_llvm_bswap_i32"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_llvm_bswap_i32"].apply(null, arguments) };
var _llvm_ctlz_i64 = Module["_llvm_ctlz_i64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_llvm_ctlz_i64"].apply(null, arguments) };
var _llvm_ctpop_i64 = Module["_llvm_ctpop_i64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_llvm_ctpop_i64"].apply(null, arguments) };
var _llvm_rint_f32 = Module["_llvm_rint_f32"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_llvm_rint_f32"].apply(null, arguments) };
var _llvm_rint_f64 = Module["_llvm_rint_f64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_llvm_rint_f64"].apply(null, arguments) };
var _malloc = Module["_malloc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_malloc"].apply(null, arguments) };
var _memalign = Module["_memalign"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_memalign"].apply(null, arguments) };
var _memcpy = Module["_memcpy"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_memcpy"].apply(null, arguments) };
var _memmove = Module["_memmove"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_memmove"].apply(null, arguments) };
var _memset = Module["_memset"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_memset"].apply(null, arguments) };
var _realloc = Module["_realloc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_realloc"].apply(null, arguments) };
var _runpage = Module["_runpage"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_runpage"].apply(null, arguments) };
var _saveSetjmp = Module["_saveSetjmp"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_saveSetjmp"].apply(null, arguments) };
var _sbrk = Module["_sbrk"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_sbrk"].apply(null, arguments) };
var _setThrew = Module["_setThrew"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_setThrew"].apply(null, arguments) };
var _testSetjmp = Module["_testSetjmp"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_testSetjmp"].apply(null, arguments) };
var establishStackSpace = Module["establishStackSpace"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["establishStackSpace"].apply(null, arguments) };
var globalCtors = Module["globalCtors"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["globalCtors"].apply(null, arguments) };
var stackAlloc = Module["stackAlloc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["stackAlloc"].apply(null, arguments) };
var stackRestore = Module["stackRestore"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["stackRestore"].apply(null, arguments) };
var stackSave = Module["stackSave"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["stackSave"].apply(null, arguments) };
var dynCall_X = Module["dynCall_X"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_X"].apply(null, arguments) };
var dynCall_i = Module["dynCall_i"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_i"].apply(null, arguments) };
var dynCall_ii = Module["dynCall_ii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_ii"].apply(null, arguments) };
var dynCall_iidiiii = Module["dynCall_iidiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iidiiii"].apply(null, arguments) };
var dynCall_iii = Module["dynCall_iii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iii"].apply(null, arguments) };
var dynCall_iiii = Module["dynCall_iiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iiii"].apply(null, arguments) };
var dynCall_iiiii = Module["dynCall_iiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iiiii"].apply(null, arguments) };
var dynCall_iiiiii = Module["dynCall_iiiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iiiiii"].apply(null, arguments) };
var dynCall_iiiiiii = Module["dynCall_iiiiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iiiiiii"].apply(null, arguments) };
var dynCall_iiiiiiii = Module["dynCall_iiiiiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iiiiiiii"].apply(null, arguments) };
var dynCall_iiiiiiiiii = Module["dynCall_iiiiiiiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iiiiiiiiii"].apply(null, arguments) };
var dynCall_v = Module["dynCall_v"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_v"].apply(null, arguments) };
var dynCall_vi = Module["dynCall_vi"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_vi"].apply(null, arguments) };
var dynCall_vii = Module["dynCall_vii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_vii"].apply(null, arguments) };
var dynCall_viii = Module["dynCall_viii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viii"].apply(null, arguments) };
var dynCall_viiii = Module["dynCall_viiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viiii"].apply(null, arguments) };

Module["dynCall_X"] = dynCall_X
Module["dynCall_i"] = dynCall_i
Module["dynCall_ii"] = dynCall_ii
Module["dynCall_iidiiii"] = dynCall_iidiiii
Module["dynCall_iii"] = dynCall_iii
Module["dynCall_iiii"] = dynCall_iiii
Module["dynCall_iiiii"] = dynCall_iiiii
Module["dynCall_iiiiii"] = dynCall_iiiiii
Module["dynCall_iiiiiii"] = dynCall_iiiiiii
Module["dynCall_iiiiiiii"] = dynCall_iiiiiiii
Module["dynCall_iiiiiiiiii"] = dynCall_iiiiiiiiii
Module["dynCall_v"] = dynCall_v
Module["dynCall_vi"] = dynCall_vi
Module["dynCall_vii"] = dynCall_vii
Module["dynCall_viii"] = dynCall_viii
Module["dynCall_viiii"] = dynCall_viiii

var NAMED_GLOBALS = {
  "str": 656648
};
for (var named in NAMED_GLOBALS) {
  Module['_' + named] = gb + NAMED_GLOBALS[named];
}
Module['NAMED_GLOBALS'] = NAMED_GLOBALS;

for (var named in NAMED_GLOBALS) {
  (function(named) {
    var addr = Module['_' + named];
    Module['g$_' + named] = function() { return addr };
  })(named);
}
;



// === Auto-generated postamble setup entry stuff ===

Module['asm'] = asm;

if (!Module["intArrayFromString"]) Module["intArrayFromString"] = function() { abort("'intArrayFromString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["intArrayToString"]) Module["intArrayToString"] = function() { abort("'intArrayToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["ccall"]) Module["ccall"] = function() { abort("'ccall' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["cwrap"]) Module["cwrap"] = function() { abort("'cwrap' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["setValue"]) Module["setValue"] = function() { abort("'setValue' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getValue"]) Module["getValue"] = function() { abort("'getValue' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["allocate"]) Module["allocate"] = function() { abort("'allocate' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getMemory"]) Module["getMemory"] = function() { abort("'getMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
Module["AsciiToString"] = AsciiToString;
if (!Module["stringToAscii"]) Module["stringToAscii"] = function() { abort("'stringToAscii' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["UTF8ArrayToString"]) Module["UTF8ArrayToString"] = function() { abort("'UTF8ArrayToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
Module["UTF8ToString"] = UTF8ToString;
if (!Module["stringToUTF8Array"]) Module["stringToUTF8Array"] = function() { abort("'stringToUTF8Array' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stringToUTF8"]) Module["stringToUTF8"] = function() { abort("'stringToUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["lengthBytesUTF8"]) Module["lengthBytesUTF8"] = function() { abort("'lengthBytesUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["UTF16ToString"]) Module["UTF16ToString"] = function() { abort("'UTF16ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stringToUTF16"]) Module["stringToUTF16"] = function() { abort("'stringToUTF16' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["lengthBytesUTF16"]) Module["lengthBytesUTF16"] = function() { abort("'lengthBytesUTF16' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["UTF32ToString"]) Module["UTF32ToString"] = function() { abort("'UTF32ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stringToUTF32"]) Module["stringToUTF32"] = function() { abort("'stringToUTF32' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["lengthBytesUTF32"]) Module["lengthBytesUTF32"] = function() { abort("'lengthBytesUTF32' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["allocateUTF8"]) Module["allocateUTF8"] = function() { abort("'allocateUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stackTrace"]) Module["stackTrace"] = function() { abort("'stackTrace' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnPreRun"]) Module["addOnPreRun"] = function() { abort("'addOnPreRun' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnInit"]) Module["addOnInit"] = function() { abort("'addOnInit' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnPreMain"]) Module["addOnPreMain"] = function() { abort("'addOnPreMain' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnExit"]) Module["addOnExit"] = function() { abort("'addOnExit' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnPostRun"]) Module["addOnPostRun"] = function() { abort("'addOnPostRun' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["writeStringToMemory"]) Module["writeStringToMemory"] = function() { abort("'writeStringToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["writeArrayToMemory"]) Module["writeArrayToMemory"] = function() { abort("'writeArrayToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["writeAsciiToMemory"]) Module["writeAsciiToMemory"] = function() { abort("'writeAsciiToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addRunDependency"]) Module["addRunDependency"] = function() { abort("'addRunDependency' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["removeRunDependency"]) Module["removeRunDependency"] = function() { abort("'removeRunDependency' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["ENV"]) Module["ENV"] = function() { abort("'ENV' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["FS"]) Module["FS"] = function() { abort("'FS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["FS_createFolder"]) Module["FS_createFolder"] = function() { abort("'FS_createFolder' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createPath"]) Module["FS_createPath"] = function() { abort("'FS_createPath' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createDataFile"]) Module["FS_createDataFile"] = function() { abort("'FS_createDataFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createPreloadedFile"]) Module["FS_createPreloadedFile"] = function() { abort("'FS_createPreloadedFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createLazyFile"]) Module["FS_createLazyFile"] = function() { abort("'FS_createLazyFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createLink"]) Module["FS_createLink"] = function() { abort("'FS_createLink' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createDevice"]) Module["FS_createDevice"] = function() { abort("'FS_createDevice' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_unlink"]) Module["FS_unlink"] = function() { abort("'FS_unlink' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["GL"]) Module["GL"] = function() { abort("'GL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["dynamicAlloc"]) Module["dynamicAlloc"] = function() { abort("'dynamicAlloc' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["warnOnce"]) Module["warnOnce"] = function() { abort("'warnOnce' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["loadDynamicLibrary"]) Module["loadDynamicLibrary"] = function() { abort("'loadDynamicLibrary' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["loadWebAssemblyModule"]) Module["loadWebAssemblyModule"] = function() { abort("'loadWebAssemblyModule' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getLEB"]) Module["getLEB"] = function() { abort("'getLEB' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getFunctionTables"]) Module["getFunctionTables"] = function() { abort("'getFunctionTables' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["alignFunctionTables"]) Module["alignFunctionTables"] = function() { abort("'alignFunctionTables' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["registerFunctions"]) Module["registerFunctions"] = function() { abort("'registerFunctions' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addFunction"]) Module["addFunction"] = function() { abort("'addFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["removeFunction"]) Module["removeFunction"] = function() { abort("'removeFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getFuncWrapper"]) Module["getFuncWrapper"] = function() { abort("'getFuncWrapper' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["prettyPrint"]) Module["prettyPrint"] = function() { abort("'prettyPrint' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["makeBigInt"]) Module["makeBigInt"] = function() { abort("'makeBigInt' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["dynCall"]) Module["dynCall"] = function() { abort("'dynCall' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getCompilerSetting"]) Module["getCompilerSetting"] = function() { abort("'getCompilerSetting' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stackSave"]) Module["stackSave"] = function() { abort("'stackSave' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stackRestore"]) Module["stackRestore"] = function() { abort("'stackRestore' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stackAlloc"]) Module["stackAlloc"] = function() { abort("'stackAlloc' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["establishStackSpace"]) Module["establishStackSpace"] = function() { abort("'establishStackSpace' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["print"]) Module["print"] = function() { abort("'print' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["printErr"]) Module["printErr"] = function() { abort("'printErr' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getTempRet0"]) Module["getTempRet0"] = function() { abort("'getTempRet0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["setTempRet0"]) Module["setTempRet0"] = function() { abort("'setTempRet0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["Pointer_stringify"]) Module["Pointer_stringify"] = function() { abort("'Pointer_stringify' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };if (!Module["ALLOC_NORMAL"]) Object.defineProperty(Module, "ALLOC_NORMAL", { get: function() { abort("'ALLOC_NORMAL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Module["ALLOC_STACK"]) Object.defineProperty(Module, "ALLOC_STACK", { get: function() { abort("'ALLOC_STACK' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Module["ALLOC_DYNAMIC"]) Object.defineProperty(Module, "ALLOC_DYNAMIC", { get: function() { abort("'ALLOC_DYNAMIC' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Module["ALLOC_NONE"]) Object.defineProperty(Module, "ALLOC_NONE", { get: function() { abort("'ALLOC_NONE' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });




/**
 * @constructor
 * @extends {Error}
 * @this {ExitStatus}
 */
function ExitStatus(status) {
  this.name = "ExitStatus";
  this.message = "Program terminated with exit(" + status + ")";
  this.status = status;
};
ExitStatus.prototype = new Error();
ExitStatus.prototype.constructor = ExitStatus;

var calledMain = false;

dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!Module['calledRun']) run();
  if (!Module['calledRun']) dependenciesFulfilled = runCaller; // try this again later, after new deps are fulfilled
}





/** @type {function(Array=)} */
function run(args) {
  args = args || Module['arguments'];

  if (runDependencies > 0) {
    return;
  }

  writeStackCookie();

  preRun();

  if (runDependencies > 0) return; // a preRun added a dependency, run will be called later
  if (Module['calledRun']) return; // run may have just been called through dependencies being fulfilled just in this very frame

  function doRun() {
    if (Module['calledRun']) return; // run may have just been called while the async setStatus time below was happening
    Module['calledRun'] = true;

    if (ABORT) return;

    ensureInitRuntime();

    preMain();

    if (Module['onRuntimeInitialized']) Module['onRuntimeInitialized']();

    assert(!Module['_main'], 'compiled without a main, but one is present. if you added it from JS, use Module["onRuntimeInitialized"]');

    postRun();
  }

  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(function() {
      setTimeout(function() {
        Module['setStatus']('');
      }, 1);
      doRun();
    }, 1);
  } else {
    doRun();
  }
  checkStackCookie();
}
Module['run'] = run;

function checkUnflushedContent() {
  // Compiler settings do not allow exiting the runtime, so flushing
  // the streams is not possible. but in ASSERTIONS mode we check
  // if there was something to flush, and if so tell the user they
  // should request that the runtime be exitable.
  // Normally we would not even include flush() at all, but in ASSERTIONS
  // builds we do so just for this check, and here we see if there is any
  // content to flush, that is, we check if there would have been
  // something a non-ASSERTIONS build would have not seen.
  // How we flush the streams depends on whether we are in SYSCALLS_REQUIRE_FILESYSTEM=0
  // mode (which has its own special function for this; otherwise, all
  // the code is inside libc)
  var print = out;
  var printErr = err;
  var has = false;
  out = err = function(x) {
    has = true;
  }
  try { // it doesn't matter if it fails
    var flush = Module['_fflush'];
    if (flush) flush(0);
    // also flush in the JS FS layer
    ['stdout', 'stderr'].forEach(function(name) {
      var info = FS.analyzePath('/dev/' + name);
      if (!info) return;
      var stream = info.object;
      var rdev = stream.rdev;
      var tty = TTY.ttys[rdev];
      if (tty && tty.output && tty.output.length) {
        has = true;
      }
    });
  } catch(e) {}
  out = print;
  err = printErr;
  if (has) {
    warnOnce('stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the FAQ), or make sure to emit a newline when you printf etc.');
  }
}

function exit(status, implicit) {
  checkUnflushedContent();

  // if this is just main exit-ing implicitly, and the status is 0, then we
  // don't need to do anything here and can just leave. if the status is
  // non-zero, though, then we need to report it.
  // (we may have warned about this earlier, if a situation justifies doing so)
  if (implicit && Module['noExitRuntime'] && status === 0) {
    return;
  }

  if (Module['noExitRuntime']) {
    // if exit() was called, we may warn the user if the runtime isn't actually being shut down
    if (!implicit) {
      err('exit(' + status + ') called, but EXIT_RUNTIME is not set, so halting execution but not exiting the runtime or preventing further async execution (build with EXIT_RUNTIME=1, if you want a true shutdown)');
    }
  } else {

    ABORT = true;
    EXITSTATUS = status;

    exitRuntime();

    if (Module['onExit']) Module['onExit'](status);
  }

  Module['quit'](status, new ExitStatus(status));
}

var abortDecorators = [];

function abort(what) {
  if (Module['onAbort']) {
    Module['onAbort'](what);
  }

  if (what !== undefined) {
    out(what);
    err(what);
    what = JSON.stringify(what)
  } else {
    what = '';
  }

  ABORT = true;
  EXITSTATUS = 1;

  var extra = '';
  var output = 'abort(' + what + ') at ' + stackTrace() + extra;
  if (abortDecorators) {
    abortDecorators.forEach(function(decorator) {
      output = decorator(output, what);
    });
  }
  throw output;
}
Module['abort'] = abort;

if (Module['preInit']) {
  if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
  while (Module['preInit'].length > 0) {
    Module['preInit'].pop()();
  }
}


  Module["noExitRuntime"] = true;

run();





// {{MODULE_ADDITIONS}}



