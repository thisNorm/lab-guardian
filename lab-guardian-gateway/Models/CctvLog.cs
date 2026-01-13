public class CctvLog {
    public int Id { get; set; }
    public string CamId { get; set; } = "";
    public string EventMessage { get; set; } = ""; // 침입 감지! 등
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}