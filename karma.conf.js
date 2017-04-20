module.exports = function(config) {
    config.set({
        frameworks: ["jasmine","source-map-support"],
        files: [
            { pattern: "dist/**/*.spec.js" }, // *.tsx for React Jsx 
            { pattern: "dist/**/*.map",included : false,served:true,watched:false,nocache:true}
        ],
    
        reporters: ["progress"],

        browsers: ["Chrome"],
        basePath: "./"
    });
};