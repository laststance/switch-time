// `import '@/global.css'` in the root layout is a side-effect import Metro (Uniwind) handles; tsc needs a module shape.
// Kept out of uniwind.d.ts: that file is a module (augmentation), and wildcard ambient modules must live in a script file.
declare module '*.css'
