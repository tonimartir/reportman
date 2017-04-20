const path = require('path');
const webpack = require('webpack');
module.exports = {
  context: path.resolve(__dirname, './src'),
  entry: {
    reportman: './reportman.ts',
    "reportman.spec": './tests/Metafile.spec.ts',
  },
  output: {
    path: path.resolve(__dirname, './dist'),
    filename: '[name].js',
  }, 
  module: {
   rules: [
     {
       test: /\.tsx?$/,
       loader: 'ts-loader',
       exclude: /node_modules/,
     },
   ]
 },
 resolve: {
   extensions: [".tsx", ".ts", ".js"]
 },
devtool: 'source-map'
};