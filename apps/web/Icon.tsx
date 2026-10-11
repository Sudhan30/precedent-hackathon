import React from 'react';

const paths = {
 chat: 'M4 4h16v12H9l-5 4V4Z M8 8h8 M8 12h5',
 shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z M8 12l3 3 5-6',
 terminal: 'm5 6 5 6-5 6 M13 18h6',
 arrow: 'M5 12h14 m-5-5 5 5-5 5',
 arrowUp: 'M12 19V5 m-6 6 6-6 6 6',
 link: 'm10 14 4-4 M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
 clock: 'M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
 activity: 'M3 12h4l3-8 4 16 3-8h4',
 check: 'm5 12 4 4 10-10',
 settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
} as const;

export function Icon({name,className=''}:{name:keyof typeof paths;className?:string}) {
 return <svg className={`icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
