import { Link } from "react-router-dom";
import "./index.css";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import ChatbotWidget from "./ChatbotWidget";
import { getHomeQuickActionsForUser } from "./quickActions";

function Home({ user, onLogout }) {
  const [notifications, setNotifications] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const notificationRef = useRef(null);

  useEffect(() => {
    if (user?.id) {
      fetchNotifications();
    }
  }, [user]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showDropdown]);

  const fetchNotifications = async () => {
    try {
      const res = await axios.get(
        `/api/notifications/${user.id}`
      );
      setNotifications(res.data.notifications);
    } catch (err) {
      console.error(err);
    }
  };

  const markAsRead = async () => {
    try {
      await axios.put(
        `/api/notifications/read/${user.id}`
      );

      setNotifications((prev) =>
        prev.map((n) => ({ ...n, is_read: true }))
      );
    } catch (err) {
      console.error(err);
    }
  };

  const quickActions = getHomeQuickActionsForUser(user);

  return (
    <div className="app">
      {/* Navbar */}
      <nav className="navbar">
        <h1 className="logo">HOSTELLE</h1>
        {user ? (
          <div className="nav-links">
            <div
              className="notification-container"
              ref={notificationRef}
              onClick={() => {
                setShowDropdown(!showDropdown);
                markAsRead();
              }}
            >
              🔔
              {notifications.some((n) => !n.is_read) && (
                <span className="notification-dot"></span>
              )}
              {showDropdown && (
                <div className="notification-dropdown">
                  {notifications.length === 0 ? (
                    <p>No notifications</p>
                  ) : (
                    notifications.map((n) => {
                      const cleanedMessage = n.message
                        ?.replace(/^user_\d+\s*/i, "")
                        .replace(/\s+Pickup:/, "\nPickup:");

                      return (
                      <div
                        key={n.id}
                        className="notification-item"
                        style={{
                          fontWeight: n.is_read ? "normal" : "bold",
                          whiteSpace: "pre-line",
                        }}
                      >
                        {cleanedMessage}
                      </div>
                    );
                    })
                  )}
                </div>
              )}
            </div>
            <button className="btn-primary nav-auth-button" onClick={onLogout}>Logout</button>
          </div>
        ) : (
          <Link to="/login" className="btn-primary nav-auth-button">Login</Link>
        )}
      </nav>

      {/* Hero Section */}
      <div className="hero">
        <h2 className="hero-title">Welcome, {user?user.name:"User"}!</h2>
        {user && (
          <p className="hero-subtitle">
            Choose a service below to manage hostel tasks quickly.
          </p>
        )}
        {!user && (
          <div className="hero-actions">
            <Link to="/login" className="btn-primary">Login to Continue</Link>
            <Link to="/register" className="btn-primary">Create Account</Link>
          </div>
        )}

        {user && (
          <section className="home-services">
            <div className="home-services-grid">
              {quickActions.map((action) => (
                <Link key={action.key} to={action.path} className="home-service-card">
                  <h4>{action.title}</h4>
                  <p>{action.description}</p>
                  <span className="home-service-cta">Open</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <ChatbotWidget
        ariaLabel="Home chatbot"
        panelTitle="Chatbot"
        initialAssistantMessage="Hi, ask me about hostels, wardens, entry/exit times, and facilities."
        inputPlaceholder="Ask your question"
        toggleClassName="home-chat-toggle"
        panelClassName="home-chat-panel"
        headerClassName="home-chat-header"
        messagesClassName="home-chat-messages"
        bubbleClassName="home-chat-bubble"
        statusClassName="home-chat-status"
        errorClassName="home-chat-error"
        inputRowClassName="home-chat-input-row"
        inputClassName=""
        sendButtonClassName="btn-primary"
      />
    </div>
  );
}

export default Home;