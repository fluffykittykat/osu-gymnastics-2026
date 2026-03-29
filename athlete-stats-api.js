// Athlete Stats API Endpoint
// This provides compiled athlete data for the chatbot

function buildAthleteStats(meetsData = [], biosData = {}) {
  const athletes = {};

  // Group scores by athlete
  meetsData.forEach(meet => {
    if (!meet.lineups) return;
    
    ['osu', 'opp1', 'opp2', 'opp3'].forEach(side => {
      if (!meet.lineups[side]) return;
      
      const lineup = meet.lineups[side];
      const isOSU = side === 'osu';
      
      Object.values(lineup).forEach(eventScores => {
        if (!Array.isArray(eventScores)) return;
        
        eventScores.forEach(score => {
          if (!score || !score.name) return;
          
          const name = score.name.trim();
          if (!athletes[name]) {
            athletes[name] = {
              name,
              bio: biosData[name] || {},
              meets: [],
              events: {
                vault: { scores: [], avg: 0, high: 0, low: 0 },
                bars: { scores: [], avg: 0, high: 0, low: 0 },
                beam: { scores: [], avg: 0, high: 0, low: 0 },
                floor: { scores: [], avg: 0, high: 0, low: 0 },
                aa: { scores: [], avg: 0, high: 0, low: 0 }
              },
              season_total: 0,
              meets_count: 0
            };
          }

          const eventKey = Object.keys(meet.lineups[side]).find(k => 
            meet.lineups[side][k].includes(score)
          );
          
          if (eventKey && score.score !== null && score.score !== undefined) {
            const numScore = parseFloat(score.score);
            if (!isNaN(numScore)) {
              athletes[name].events[eventKey].scores.push(numScore);
              athletes[name].meets.push({
                date: meet.date,
                opponent: isOSU ? meet.opponent : 'vs OSU',
                event: eventKey,
                score: numScore
              });
            }
          }
        });
      });
    });
  });

  // Calculate stats for each athlete
  Object.values(athletes).forEach(athlete => {
    if (athlete.meets.length === 0) return;

    athlete.meets_count = new Set(athlete.meets.map(m => m.date)).size;

    ['vault', 'bars', 'beam', 'floor', 'aa'].forEach(event => {
      const scores = athlete.events[event].scores;
      if (scores.length > 0) {
        athlete.events[event].avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        athlete.events[event].high = Math.max(...scores);
        athlete.events[event].low = Math.min(...scores);
      }
    });

    // Season total (best AA or sum of event averages)
    const aaScores = athlete.events.aa.scores;
    if (aaScores.length > 0) {
      athlete.season_total = aaScores.reduce((a, b) => a + b, 0) / aaScores.length;
    } else {
      const eventAvgs = ['vault', 'bars', 'beam', 'floor'].map(e => athlete.events[e].avg);
      athlete.season_total = eventAvgs.filter(a => a > 0).reduce((a, b) => a + b, 0);
    }
  });

  return athletes;
}

module.exports = { buildAthleteStats };
