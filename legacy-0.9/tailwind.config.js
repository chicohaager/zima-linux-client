/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/**/*.{ts,tsx}",
  ],
  darkMode: 'class', // Enable dark mode via class strategy
  theme: {
    extend: {
      colors: {
        zima: {
          blue: '#4A9FFF',
          dark: '#1A1A1A',
          gray: '#2D2D2D',
          'light-bg': '#E8EDF2',
          'card-bg': '#FFFFFF',
          'text-primary': '#1A1A1A',
          'text-secondary': '#8E8E93',
          'nav-bg': '#1C1C1E',
        }
      }
    },
  },
  plugins: [],
}
