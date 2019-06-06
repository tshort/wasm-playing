
mergeInto(LibraryManager.library, {
    julia_ptls_states: function() {
        return 1000000;
    },
    lognum: function(num) {
        console.log(num);
    },
    logstring: function(num) {
        console.log(num);
        console.log(UTF8ToString(num+4));
    },
    getnum: function() {
        return 343434; 
    },
    sendarray: function(x) {
        console.log(x);
        // console.log(Module.HEAP32[x]);
    },
    i32_from_id: function(id) {
        return $("#" + UTF8ToString(id+4))[0].value; 
    },
    string_test: function() {
        var ptr  = allocate(intArrayFromString("aaaaaaaaaaaabbbbbbbbb"), 'i8', ALLOC_NORMAL);
        Module.UTF8ToString(35554144)
        return ptr;
    },
    string_from_id: function(id) {
        var s = $("#" + UTF8ToString(id+4))[0].value; 
        var ptr  = allocate(intArrayFromString(s), 'i8', ALLOC_NORMAL);
        return ptr;
    },
    update_id: function(chunkid, chunkresult) {
        $('#' + UTF8ToString(chunkid+4)).html(UTF8ToString(chunkresult+4));
    },
    update_id0: function(chunkid, chunkresult) {
        $('#' + UTF8ToString(chunkid+4)).html(chunkresult);
    },
});
