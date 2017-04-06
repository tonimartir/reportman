module.exports = function(config) {
    config.set({
        frameworks: ["jasmine","source-map-support"],
        files: [
            { pattern: "dist/**/*test.js" } // *.tsx for React Jsx 
        ],
        reporters: ["progress"],
        browsers: ["Chrome"],
    });
};