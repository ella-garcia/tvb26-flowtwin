// Mobile reply page, opened from a WhatsApp or email link (#r/<token>). Spanish first, no login, no Shell.
// Placeholder from WP0; WP6 builds the page (reply_context / reply_submit RPCs) and WP7 adds AI extraction.
import "./reply.css";

export default function ReplyPage({ token }: { token: string }) {
  void token; // WP6: load reply_context(token)
  return (
    <main className="reply" lang="es">
      <div className="reply-card ft-card">
        <p className="reply-brand">FlowTwin</p>
        <h1 className="ft-title">Página de respuesta</h1>
        <p className="ft-caption">Aquí podrás responder a un aviso de tu cliente en un toque. Esta página todavía no está disponible.</p>
      </div>
    </main>
  );
}
