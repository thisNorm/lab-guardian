public class RobotLog {
    public int Id { get; set; }
    public string RobotId { get; set; } = "";
    public string Status { get; set; } = ""; // IDLE, MOVING 등
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}