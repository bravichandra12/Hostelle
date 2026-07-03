import { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

function ApplyFine({ user }) {
  const [rollNo, setRollNo] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const navigate = useNavigate();

  const validateForm = () => {
    if (!rollNo.trim() || !description.trim() || !amount.trim()) {
      setErrorMessage("All fields are required.");
      return false;
    }

    if (isNaN(amount) || Number(amount) <= 0) {
      setErrorMessage("Amount must be a valid positive number.");
      return false;
    }

    return true;
  };

  const resetForm = () => {
    setRollNo("");
    setDescription("");
    setAmount("");
    setSuccessMessage("");
    setErrorMessage("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSuccessMessage("");
    setErrorMessage("");

    // 🔥 FIX 1: Check user exists
    if (!user?.id) {
      setErrorMessage("User not loaded. Please login again.");
      return;
    }

    if (!validateForm()) return;

    setIsLoading(true);

    try {
      const requestBody = {
        caretakerId: user.id,
        rollNo: rollNo.trim().toLowerCase(),
        description: description.trim(),
        amount: Number(amount),
      };

      // 🔍 DEBUG (important)
      console.log("REQUEST BODY:", requestBody);

      await axios.post(
        "/api/fines/apply",
        requestBody
      );

      setSuccessMessage("✅ Fine applied successfully!");
      alert("✅ Fine notification sent to the student!");
      resetForm();
      navigate("/");

    } catch (error) {
      console.error("Error applying fine:", error);

      setErrorMessage(
        error.response?.data?.error ||
        error.message ||
        "Failed to apply fine. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ marginTop: "120px", padding: "20px", maxWidth: "500px", margin: "120px auto" }}>
      <h2>Apply Fine</h2>

      {successMessage && (
        <div style={{ color: "green", marginBottom: "15px", fontWeight: "bold" }}>
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div style={{ color: "red", marginBottom: "15px", fontWeight: "bold" }}>
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        
        {/* Roll Number */}
        <div style={{ marginBottom: "15px" }}>
          <label style={{ display: "block", marginBottom: "5px" }}>
            Student Roll Number:
          </label>
          <input
            type="text"
            value={rollNo}
            onChange={(e) => setRollNo(e.target.value)}
            placeholder="e.g. 22bcs123"
            style={{
              width: "100%",
              padding: "8px",
              borderRadius: "4px",
              border: "1px solid #ccc",
            }}
            disabled={isLoading}
          />
        </div>

        {/* Description */}
        <div style={{ marginBottom: "15px" }}>
          <label style={{ display: "block", marginBottom: "5px" }}>
            Description:
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Enter reason for fine"
            style={{
              width: "100%",
              padding: "8px",
              borderRadius: "4px",
              border: "1px solid #ccc",
              minHeight: "100px",
            }}
            disabled={isLoading}
          />
        </div>

        {/* Amount */}
        <div style={{ marginBottom: "15px" }}>
          <label style={{ display: "block", marginBottom: "5px" }}>
            Amount:
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Enter fine amount"
            min="1"
            style={{
              width: "100%",
              padding: "8px",
              borderRadius: "4px",
              border: "1px solid #ccc",
            }}
            disabled={isLoading}
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          style={{
            padding: "10px 20px",
            backgroundColor: isLoading ? "#999" : "#007bff",
            color: "white",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            borderRadius: "4px",
            cursor: isLoading ? "not-allowed" : "pointer",
          }}
        >
          {isLoading ? "Applying..." : "Apply Fine"}
        </button>
      </form>
    </div>
  );
}

export default ApplyFine;