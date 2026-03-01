/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      animation: {
        pulseSlow: 'pulse 3s ease-in-out infinite'
      }
    },
  },
  plugins: [],
}
