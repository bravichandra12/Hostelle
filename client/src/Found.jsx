import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./LostFound.css";

const getSavedUser = () => {
  try {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const toSearchableText = (item) =>
  [
    item.title,
    item.description,
    item.hostel,
    item.location,
    item.userName,
    item.userUsername,
  ]
    .filter(Boolean)
    .join(" ");

function Found() {
  const [items, setItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredItems, setFilteredItems] = useState([]);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const savedUser = getSavedUser();

  const applySearch = (sourceItems, queryText = searchQuery) => {
    const searchText = queryText.trim().toLowerCase();

    if (!searchText) {
      return sourceItems;
    }

    const filteredTodos = sourceItems.filter((item) =>
      toSearchableText(item).toLowerCase().includes(searchText)
    );

    return filteredTodos;
  };

  const handleSearch = () => {
    setFilteredItems(applySearch(items));
  };

  const handleCardKeyDown = (event, itemId) => {
    if (event.key === "Enter") {
      navigate(`/lost-found/item/${itemId}`);
    }
  };

  useEffect(() => {
    const loadItems = async () => {
      try {
        const response = await fetch("/api/lostfound/lost");
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          throw new Error("API returned non-JSON response. Is the server running on port 5000?");
        }
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Unable to fetch items");
        }
        const nextItems = result.items || [];
        setItems(nextItems);
        setFilteredItems(applySearch(nextItems, searchQuery));
      } catch (err) {
        setError(err.message);
      }
    };

    loadItems();
  }, []);

  const handleDelete = async (event, itemId) => {
    event.stopPropagation();
    setError(null);

    if (!savedUser?.id) {
      setError("Please login to delete this post.");
      return;
    }

    try {
      const response = await fetch(`/api/lostfound/${itemId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: savedUser.id }),
      });

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("API returned non-JSON response. Is the server running on port 5000?");
      }

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Unable to delete post");
      }

      setItems((prev) => {
        const nextItems = prev.filter((item) => item.id !== itemId);
        setFilteredItems(applySearch(nextItems, searchQuery));
        return nextItems;
      });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="lf-page">
      <div className="lf-shell">
        <header className="lf-header">
          <p className="lf-eyebrow">Found Flow</p>
          <h1 className="lf-title">Check what others lost</h1>
          <p className="lf-subtitle">
            Browse lost posts from other users. If nothing matches, post what you found.
          </p>
        </header>

        <div className="lf-toolbar">
          <div className="lf-post">
            <p>Didn't find anything? Post here.</p>
            <button className="lf-button" type="button" onClick={() => navigate("/lost-found/post/found")}>Post</button>
          </div>

          <div className="lf-search">
            <input
              type="text"
              placeholder="Search lost items"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <button className="lf-button secondary" type="button" onClick={handleSearch}>
              Search
            </button>
          </div>
        </div>

        {error && <p className="lf-error">{error}</p>}

        <section className="lf-list">
          {filteredItems.length === 0 ? (
            <p className="lf-empty">
              {searchQuery.trim() ? "No close matches found." : "No lost items yet."}
            </p>
          ) : (
            filteredItems.map((item) => (
              <article
                key={item.id}
                className="lf-item lf-item-link"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/lost-found/item/${item.id}`)}
                onKeyDown={(event) => handleCardKeyDown(event, item.id)}
              >
                <div className="lf-item-top">
                  <p className="lf-user">
                    Posted by{" "}
                    {item.userUsername ? (
                      <Link
                        className="lf-user-link"
                        to={`/profile/${item.userUsername}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {item.userName || item.userUsername}
                      </Link>
                    ) : (
                      <span>{item.userName || "Anonymous"}</span>
                    )}
                  </p>
                  {savedUser?.id === item.userId && (
                    <button
                      className="lf-button secondary lf-delete-button"
                      type="button"
                      onClick={(event) => handleDelete(event, item.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
                <h4>{item.title}</h4>
                <p>{item.description}</p>
                <div className="lf-meta">
                  <span>Hostel: {item.hostel}</span>
                  {item.location && <span>Location: {item.location}</span>}
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

export default Found;