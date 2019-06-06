var Module = {}

function autoPageRun() {
    $(':input').change(function() {
        Module._runpage();
    });
}

function init() {
    Module._init_lib();
    Module._runpage();
}

Module.preRun = [autoPageRun];
Module.onRuntimeInitialized = init;    