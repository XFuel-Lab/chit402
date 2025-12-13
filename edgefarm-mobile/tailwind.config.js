/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          950: '#05050a',
          900: '#0a0a14',
        },
        neon: {
          purple: '#a855f7',
          blue: '#38bdf8',
          pink: '#fb7185',
          green: '#34d399',
          amber: '#fbbf24',
        },
        card: {
          900: 'rgba(20, 20, 36, 0.65)',
          border: 'rgba(168, 85, 247, 0.22)',
        },
      },
    },
  },
  plugins: [],
}
