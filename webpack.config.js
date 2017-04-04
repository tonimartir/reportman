const path = require('path');
const webpack = require('webpack');
module.exports = {
  context: path.resolve(__dirname, './js'),
  entry: {
    app: './reportman.ts',
  },
  output: {
    path: path.resolve(__dirname, './dist'),
    filename: 'reportman.bundle.js',
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
 }
};