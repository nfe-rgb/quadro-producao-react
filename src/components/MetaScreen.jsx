// src/components/MetaScreen.jsx
export default function MetaScreen() {
  // Você pode puxar a produção/meta do Supabase aqui
  const percentual = 72; // exemplo

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "black",
        color: "white",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "4rem",
        fontWeight: "bold",
      }}
    >
      Estamos em
      <div style={{ fontSize: "8rem", marginTop: 20 }}>{percentual}%</div>
      da meta diária
    </div>
  );
}
