export const DOMAIN_SAMPLES = {
  sensors: { name:'sensor-measurements.csv', content:'Sensor,Temperature,Pressure,Velocity\nA,18.4,101.2,3.2\nB,21.5,104.7,4.8\nA,23.1,102.8,5.4\nC,17.9,100.1,2.8\nB,25.4,108.3,6.7\nC,20.3,103.2,4.1\nA,26.2,109.6,7.3\nB,19.8,102.4,3.9' },
  categories: { name:'service-records.json', content:JSON.stringify([
    {Department:'Operations',Status:'Open'},{Department:'Lab',Status:'Closed'},{Department:'Operations',Status:'Open'},
    {Department:'Support',Status:'Closed'},{Department:'Lab',Status:'Open'},{Department:'Support',Status:'Open'},
    {Department:'Operations',Status:'Closed'},{Department:'Lab',Status:'Closed'},
  ]) },
};
