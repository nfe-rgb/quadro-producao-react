import React, { useState } from 'react';
import '../styles/PieChartIndicadores.css';

export default function PieChartIndicadores({ data, totalMaquinasParadas = 0 }) {
  const total = data.reduce((acc, d) => acc + (Number(d.value) || 0), 0);
  const [hoveredIndex, setHoveredIndex] = useState(null);

  const radius = 90;
  const cx = 100;
  const cy = 100;

  // converte horas decimais (ex: 17.2799) para "HH:MM:SS"
  function formatHoursToHMS(hoursDecimal) {
    const totalSec = Math.round((Number(hoursDecimal) || 0) * 3600);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  // formata percentual com vírgula decimal (ex: 23,4%)
  function formatPct(v) {
    const p = total ? (Number(v) / total) * 100 : 0;
    // usa vírgula para decimal conforme exemplo
    return `${p.toFixed(1).replace('.', ',')}%`;
  }

  // monta fatias SVG
  let acc = 0;
  const slices = data.map((d, i) => {
    const val = Number(d.value) || 0;

    // se uma fatia ocupa 100% desenha um círculo cheio
    if (val === total && total > 0) {
      return (
        <circle
          key={d.label}
          cx={cx}
          cy={cy}
          r={radius}
          fill={d.color}
          className={`slice ${hoveredIndex === i ? 'hovered' : ''}`}
          onMouseEnter={() => setHoveredIndex(i)}
          onMouseLeave={() => setHoveredIndex(null)}
        />
      );
    }

    const startAngle = (acc / (total || 1)) * 2 * Math.PI;
    acc += val;
    const endAngle = (acc / (total || 1)) * 2 * Math.PI;
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

  // hover info text formatted: "17:16:47 = 23,4%"
  const hoverText = hoveredIndex !== null
    ? `${formatHoursToHMS(data[hoveredIndex].value)} = ${formatPct(data[hoveredIndex].value)}`
    : null;

  return (
    <div className="piechart-wrapper">
      <div className="piechart-row single">
        <div className="piechart-container">
          <svg width={240} height={240} viewBox="0 0 200 200" className="piechart-svg" aria-hidden>
            {slices}

            <circle cx={cx} cy={cy} r={60} className="center-hole" />

            <text className="center-title" x={cx} y={cy + 5}>
              Indicadores
            </text>
          </svg>
        </div>
      </div>

      {/* Hover info fora do SVG: mostra HH:MM:SS = XX,X% ou placeholder */}
      <div className="hover-info-container">
        {hoverText ? (
          <div className="hover-info"><strong>{data[hoveredIndex].label}:</strong> {hoverText}</div>
        ) : (
          <div className="hover-placeholder">Passe o mouse sobre uma fatia para ver horas e percentual</div>
        )}
      </div>

      {/* Total de máquinas paradas exibido logo abaixo do placeholder */}
        <div className="parada-count">Tempo total disponível: <strong>{formatHoursToHMS(total)}</strong></div>
    </div>
  );
}
