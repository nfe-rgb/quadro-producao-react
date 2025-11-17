import React, { useState } from 'react';
import '../styles/PieChartIndicadores.css';

export default function PieChartIndicadores({ data }) {
  const total = data.reduce((acc, d) => acc + d.value, 0);
  const [hoveredIndex, setHoveredIndex] = useState(null);

  let acc = 0;
  const radius = 90;
  const cx = 100;
  const cy = 100;

  const slices = data.map((d, i) => {
    const startAngle = (acc / total) * 2 * Math.PI;
    acc += d.value;
    const endAngle = (acc / total) * 2 * Math.PI;

    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);

    const path = `M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${largeArc},1 ${x2},${y2} Z`;

    return (
      <path
        key={d.label}
        className={`slice ${hoveredIndex === i ? 'hovered' : ''}`}
        d={path}
        fill={d.color}
        onMouseEnter={() => setHoveredIndex(i)}
        onMouseLeave={() => setHoveredIndex(null)}
      />
    );
  });

  return (
    <div className="piechart-wrapper">
      {/* <div className="piechart-header">
        <button className="filtro-btn">Filtrar</button>
      </div> */}
      <div className="piechart-container">
        <svg width={240} height={240} viewBox="0 0 200 200" className="piechart-svg">
          {slices}

          <circle cx={cx} cy={cy} r={60} className="center-hole" />

          <text className="center-title" x={cx} y={cy + 5}>
            Indicadores
          </text>
        </svg>
      </div>

      {/* TEXTO DO HOVER FORA DO GRÁFICO (melhor visual) */}
      <div className="hover-info-container">
        {hoveredIndex !== null ? (
          <span className="hover-info">
            {data[hoveredIndex].label}: {((data[hoveredIndex].value / total) * 100).toFixed(1)}%
          </span>
        ) : (
          <span className="hover-placeholder">Passe o mouse para ver detalhes</span>
        )}
      </div>
    </div>
  );
}
