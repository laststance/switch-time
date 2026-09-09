// Uniwind compiles src/global.css (Tailwind v4) inside Metro; it has to be the outermost wrapper.
const { getDefaultConfig } = require('expo/metro-config')
const { withUniwindConfig } = require('uniwind/metro')

module.exports = withUniwindConfig(getDefaultConfig(__dirname), {
  cssEntryFile: './src/global.css',
})
