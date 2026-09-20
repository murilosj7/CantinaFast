/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta CantinaFast: laranja-torrado (apetite/calor) + verde-oliva (fresco) + creme
        brasa: {
          50: '#fdf3ee',
          100: '#fbe3d6',
          200: '#f6c4a8',
          300: '#efa073',
          400: '#e57941',
          500: '#d85f24', // primária
          600: '#b6481a',
          700: '#933918',
          800: '#772f19',
          900: '#632918',
        },
        oliva: {
          50: '#f4f6ee',
          100: '#e6ebd7',
          200: '#cdd8b1',
          300: '#adbe82',
          400: '#8fa55d',
          500: '#728a42', // secundária
          600: '#576b33',
          700: '#44522a',
          800: '#394324',
          900: '#313a21',
        },
        creme: '#fbf7f0',
        carvao: '#241c16',
      },
      fontFamily: {
        display: ['"Fraunces"', 'serif'],
        sans: ['"Work Sans"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '0.625rem',
      },
    },
  },
  plugins: [],
};
