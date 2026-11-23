import { defineConfig } from 'vite';
export default defineConfig({
  base:'./',
  build:{
    chunkSizeWarningLimit:1500,
    rollupOptions:{
      output:{
        manualChunks(id){
          if(id.endsWith('/.generated/arena-sprites.ts'))return 'arena-sprites';
        },
      },
    },
  },
});
