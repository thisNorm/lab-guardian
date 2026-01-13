using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace lab_guardian_gateway.Models;

public class EventLog {
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    public int Id { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public string? CctvLog { get; set; }
    public string? RobotLog { get; set; }
    [Required]
    public string CamId { get; set; } = string.Empty;
}