export const logger = {
  info: (message: string) => {
    console.log(`ℹ ${message}`);
  },

  success: (message: string) => {
    console.log(`✓ ${message}`);
  },

  error: (message: string) => {
    console.error(`✗ ${message}`);
  },

  debug: (message: string) => {
    if (process.env.DEBUG === 'true') {
      console.log(`[DEBUG] ${message}`);
    }
  }
};
