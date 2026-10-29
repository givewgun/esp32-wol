import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.test.{js,jsx}'],
    environment: 'node',
    environmentMatchGlobs: [['test/**/*.test.jsx', 'jsdom']],
  },
});
