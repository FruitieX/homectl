/** @type {import('tailwindcss').Config} */
module.exports = {
  plugins: [require('daisyui')],
  daisyui: {
    themes: ['business', 'corporate'],
  },
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './page/**/*.{js,ts,jsx,tsx}',
    './ui/**/*.{js,ts,jsx,tsx}',
    'node_modules/daisyui/dist/**/*.js',
    'node_modules/react-daisyui/dist/**/*.js',
  ],
};
