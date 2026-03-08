module.exports = {
  apps: [{
    name: 'osu-gymnastics',
    script: 'server.js',
    cwd: '/home/mansona/workspace/osu-gymnastics-2026',
    watch: false,
    restart_delay: 2000,
    max_restarts: 10,
    env: { NODE_ENV: 'production', PORT: 8888 }
  }]
};
