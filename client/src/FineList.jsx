import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import "./LostFound.css";
import "./FineList.css";

function FineList({ user }) {
  const [fines, setFines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchFines = async () => {
      try {
        const res = await axios.get(
          `/api/fines/caretaker/${user.id}`
        );
        setFines(res.data.fines);
      } catch (err) {
        console.error(err);
        setError("Unable to load fines");
      } finally {
        setLoading(false);
      }
    };

    if (user?.id) fetchFines();
  }, [user]);

  const markAsPaid = async (id) => {
    try {
      await axios.put(
        `/api/fines/${id}/mark-paid`
      );

      // Remove from UI instantly
      setFines((prev) => prev.filter((f) => f.id !== id));

    } catch (err) {
      console.error(err);
      setError("Unable to mark fine as paid");
    }
  };

  if (loading) {
    return (
      <div className="lf-page">
        <div className="lf-shell">
          <p className="lf-empty">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="lf-page">
        <div className="lf-shell">
          <div className="lf-card">
            <h2>Fine List</h2>
            <p>Please log in to view fines.</p>
            <Link to="/login" className="lf-button">
              Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lf-page fine-page">
      <div className="lf-shell">
        <header className="lf-header">
          <p className="lf-eyebrow">Caretaker Portal</p>
          <h1 className="lf-title">Fine List</h1>
          <p className="lf-subtitle">Track pending fines and mark payments.</p>
        </header>

        {error && <p className="lf-error">{error}</p>}

        {!error && fines.length === 0 && (
          <p className="lf-empty">No unpaid fines.</p>
        )}

        {!error && fines.length > 0 && (
          <div className="lf-list">
            {fines.map((fine) => {
              const username = String(fine.student_email || "").split("@")[0];
              return (
                <article key={fine.id} className="lf-item fine-item">
                  <div className="lf-item-top">
                    <h4>{username || "Student"}</h4>
                    <span className="fine-status">Unpaid</span>
                  </div>

                  <p>{fine.description}</p>

                  <div className="lf-meta">
                    <span>Amount: ₹{fine.amount}</span>
                    <span>Email: {fine.student_email}</span>
                  </div>

                  <div className="fine-actions">
                    <button
                      type="button"
                      className="fine-paid-btn"
                      onClick={() => markAsPaid(fine.id)}
                    >
                      Mark as Paid
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="fine-footer-actions">
          <Link to="/apply-fine" className="lf-button">
            Apply Fine
          </Link>
          <Link to="/" className="lf-button secondary">
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default FineList;