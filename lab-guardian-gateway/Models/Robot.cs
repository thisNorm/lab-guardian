using System.ComponentModel.DataAnnotations;

namespace lab_guardian_gateway.Models;

public class Robot {
    [Key]
    public string Id { get; set; } = string.Empty;
    public string IpAddress { get; set; } = string.Empty;
    public DateTime LastActive { get; set; } = DateTime.Now;
}