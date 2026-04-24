import { useEffect, useState } from 'react';
import { fetchPipelineStages } from '../services/api';
import type { PipelineStage } from '../types';

export function InfraPipeline() {
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    let active = true;
    fetchPipelineStages()
      .then((stages) => {
        if (active) {
          setPipelineStages(stages);
          setActiveIndex(0);
        }
      })
      .catch(() => {
        if (active) setPipelineStages([]);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (pipelineStages.length === 0) return;

    const intervalId = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % pipelineStages.length);
    }, 1200);

    return () => window.clearInterval(intervalId);
  }, [pipelineStages.length]);

  return (
    <section className="infra-pipeline" aria-label="Athena pipeline animation">
      <div className="infra-pipeline-head">
        <span className="infra-pipeline-head-pill">RUNNING</span>
        <span className="infra-pipeline-head-meta">athena://pipeline/live</span>
      </div>

      <ol className="infra-pipeline-list">
        {pipelineStages.map((stage, index) => {
          const isDone = index < activeIndex;
          const isActive = index === activeIndex;
          const className = [
            'infra-pipeline-step',
            isDone ? 'is-done' : '',
            isActive ? 'is-active' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <li key={stage.id} className={className}>
              <span className="infra-pipeline-node" aria-hidden="true" />
              <div className="infra-pipeline-step-head">
                <span className="infra-pipeline-index">{stage.id}</span>
                <h3>{stage.title}</h3>
                <span className="infra-pipeline-metric">{stage.metric}</span>
              </div>
              <p>{stage.detail}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
