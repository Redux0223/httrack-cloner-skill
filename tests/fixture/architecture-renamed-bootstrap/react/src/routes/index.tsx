
    import { createFileRoute } from '@tanstack/react-router';
    import { useEffect, useRef } from 'react';
    import { createExperience } from '../engines/demo';
    export const Route = createFileRoute('/')({ component: Home });
    function Home(){ const ref=useRef(null); useEffect(()=>{const engine=createExperience(ref.current);engine.start();return()=>engine.destroy()},[]); return <canvas ref={ref}/>; }
  