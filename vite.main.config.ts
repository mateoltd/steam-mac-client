import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __DEBUG_URL__: JSON.stringify(process.env.SMC_DEBUG_URL || ''),
  },
  resolve: {
    conditions: ['node'],
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
});
