/*"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
exports.__esModule = true;
var jasmine_spec_reporter_1 = require("jasmine-spec-reporter");
var jasmine_spec_reporter_2 = require("jasmine-spec-reporter");
var Jasmine = require("jasmine");
var CustomProcessor = (function (_super) {
    __extends(CustomProcessor, _super);
    function CustomProcessor() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    CustomProcessor.prototype.displayJasmineStarted = function (info, log) {
        this.configuration.stacktrace = true;
        return "TypeScript " + log;
    };
    return CustomProcessor;
}(jasmine_spec_reporter_2.DisplayProcessor));
var jrunner = new Jasmine();
jrunner.env.clearReporters();
jrunner.addReporter(new jasmine_spec_reporter_1.SpecReporter({
    customProcessors: [CustomProcessor]
}));
jrunner.loadConfigFile();
jrunner.execute();
*/